from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import firebase_admin
from firebase_admin import credentials, auth, firestore
from datetime import datetime, timedelta
import json

from flask_apscheduler import APScheduler

# ai_logic.py から必要な関数とクラスをインポート
from ai_logic import AIModel, Task, prepare_inputs_from_react, suggest_best_slot, learning, TOTAL_SLOTS, REJECTION_PENALTY, QLearningAgent
from datetime import datetime, timedelta, timezone 
JST = timezone(timedelta(hours=+9))

# データ保存ディレクトリの定義と作成 (サーバー起動時に確認)
DATA_DIR = 'data'
AI_MODELS_DIR = os.path.join(DATA_DIR, 'ai_models')
USER_TASKS_DIR = os.path.join(DATA_DIR, 'user_tasks')
UNAVAILABLE_SLOTS_DIR = os.path.join(DATA_DIR, 'unavailable_slots')
USER_PREFERENCES_DIR = os.path.join(DATA_DIR, 'user_preferences')

# Flaskアプリケーションの準備
app = Flask(__name__)
CORS(app) # アプリ全体でCORSを有効にする

class Config:
    """APSchedulerの基本的な設定"""
    SCHEDULER_API_ENABLED = True

app.config.from_object(Config())

# スケジューラのインスタンスを作成
scheduler = APScheduler()
# アプリケーションにスケジューラを組み込み、開始する
scheduler.init_app(app)
scheduler.start()

@app.before_request
def ensure_data_dirs():
    """リクエスト処理前にデータ保存ディレクトリが存在することを確認"""
    os.makedirs(AI_MODELS_DIR, exist_ok=True)
    os.makedirs(USER_TASKS_DIR, exist_ok=True)
    os.makedirs(UNAVAILABLE_SLOTS_DIR, exist_ok=True)
    os.makedirs(USER_PREFERENCES_DIR, exist_ok=True) # 追加

# --- データ読み書きヘルパー関数 (ファイルベース) ---
def load_ai_model(user_id):
    """
    ユーザーのAIモデルを読み込む。
    存在しない場合は、ユーザー設定に基づいて新しいモデルを作成する。
    """
    model_path = os.path.join(AI_MODELS_DIR, f'{user_id}.json')
    
    # ユーザーのモデルファイルが既に存在する場合
    if os.path.exists(model_path):
        with open(model_path, 'r', encoding='utf-8') as f:
            try:
                model_data = json.load(f)
                # ファイルが空でないことを確認
                if model_data:
                    print(f"[{user_id}] 既存のAIモデルを読み込みました。")
                    return AIModel(model_data)
                else:
                    print(f"警告: モデルファイル {model_path} が空です。新しいモデルを作成します。")
            except json.JSONDecodeError:
                print(f"警告: モデルファイル {model_path} が壊れています。新しいモデルを作成します。")
                # 壊れていた場合も、新規作成ロジックに流す
                pass

    # --- 新規ユーザー、またはモデルファイルが壊れていた/空だった場合の処理 ---
    print(f"[{user_id}] AIモデルの新規作成ロジックを開始します。")
    preference_data = load_user_preference(user_id)
    preference_type = preference_data.get("preferenceType", "neutral") # デフォルトは neutral

    template_filename = None
    if preference_type == 'morning':
        template_filename = 'trained_morning_model.json'
    elif preference_type == 'night':
        template_filename = 'trained_night_model.json'
        
    # 朝型または夜型のテンプレートファイルが存在する場合、それを読み込む
    if template_filename:
        # dataディレクトリ内へのフルパスを作成
        template_path = os.path.join(DATA_DIR, template_filename)
        
        # 修正したパスでファイルの存在を確認
        if os.path.exists(template_path):
            print(f"[{user_id}] {preference_type} の設定に基づき、テンプレート '{template_path}' からモデルを初期化します。")
            # 修正したパスでファイルを開く
            with open(template_path, 'r', encoding='utf-8') as f:
                try:
                    template_data = json.load(f)
                    new_model = AIModel(template_data)
                    save_ai_model(user_id, new_model)
                    print(f"[{user_id}] テンプレートから初期化したモデルを保存しました。")
                    return new_model
                except json.JSONDecodeError:
                    print(f"警告: テンプレートファイル '{template_filename}' が壊れています。デフォルトモデルで初期化します。")
        elif template_filename:
            print(f"警告: テンプレートファイル '{template_filename}' が見つかりません。デフォルトモデルで初期化します。")

    # neutralの場合、またはテンプレートが利用できなかった場合、デフォルトモデルを初期化
    print(f"[{user_id}] デフォルトのAIモデルを新規に作成します。")
    new_model = AIModel(None) # ai_logic.py の _initialize_new_model が呼ばれる
    save_ai_model(user_id, new_model)
    print(f"[{user_id}] デフォルトの新規モデルを保存しました。")
    return new_model


def save_ai_model(user_id, ai_model):
    model_path = os.path.join(AI_MODELS_DIR, f'{user_id}.json')
    with open(model_path, 'w', encoding='utf-8') as f:
        json.dump(ai_model.to_json(), f, indent=2, ensure_ascii=False)

def load_user_tasks(user_id):
    tasks_path = os.path.join(USER_TASKS_DIR, f'{user_id}_tasks.json')
    if os.path.exists(tasks_path):
        with open(tasks_path, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return [] # 空または壊れたファイルの場合は空リストを返す
    return []

def save_user_tasks(user_id, tasks_list):
    tasks_path = os.path.join(USER_TASKS_DIR, f'{user_id}_tasks.json')
    with open(tasks_path, 'w', encoding='utf-8') as f:
        json.dump(tasks_list, f, indent=2, ensure_ascii=False)

def load_unavailable_slots(user_id):
    slots_path = os.path.join(UNAVAILABLE_SLOTS_DIR, f'{user_id}_unavailable_slots.json')
    if os.path.exists(slots_path):
        with open(slots_path, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []
    return []

def save_unavailable_slots(user_id, slots_list):
    slots_path = os.path.join(UNAVAILABLE_SLOTS_DIR, f'{user_id}_unavailable_slots.json')
    with open(slots_path, 'w', encoding='utf-8') as f:
        json.dump(slots_list, f, indent=2, ensure_ascii=False)

def load_user_preference(user_id):
    pref_path = os.path.join(USER_PREFERENCES_DIR, f'{user_id}_preference.json')
    if os.path.exists(pref_path):
        with open(pref_path, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {"preferenceType": "neutral"}
    return {"preferenceType": "neutral"} # デフォルト値

def save_user_preference(user_id, preference_data):
    pref_path = os.path.join(USER_PREFERENCES_DIR, f'{user_id}_preference.json')
    with open(pref_path, 'w', encoding='utf-8') as f:
        json.dump(preference_data, f, indent=2, ensure_ascii=False)


def learn_from_feedback_and_save(user_id, start_time_iso, end_time_iso, rating, react_tasks, unavailable_slots, existing_tasks):
    """
    フィードバックに基づき、AIモデルの学習ジョブを非同期で実行する関数。
    """
    try:
        print(f"[{user_id}] バックグラウンド学習ジョブを開始します (トリガー: フィードバック)。")
        
        ai_model_obj = load_ai_model(user_id)
        ai_model_obj.apply_completion_feedback(start_time_iso, end_time_iso, rating)
        current_model_data = ai_model_obj.to_json()

        tasks_for_learning, ng_zones_for_learning = prepare_inputs_from_react(
            react_tasks, unavailable_slots, existing_tasks, for_learning=True
        )
        
        if not tasks_for_learning:
            save_ai_model(user_id, ai_model_obj)
            print(f"[{user_id}] 学習対象タスクなし。集中度マップのみ更新して保存しました。")
            return

        updated_model_data = learning(
            tasks_for_learning, ng_zones_for_learning, current_model_data
        )
        
        updated_ai_model = AIModel(updated_model_data)
        save_ai_model(user_id, updated_ai_model)
        
        print(f"[{user_id}] バックグラウンド学習ジョブが完了し、モデルを保存しました。")

    except Exception as e:
        print(f"[{user_id}] バックグラウンド学習ジョブでエラーが発生しました: {e}")
        import traceback
        traceback.print_exc()

def apply_skip_feedback_and_save(user_id, task_id, start_time_iso, end_time_iso):
    """
    スキップされた課題のフィードバックに基づき、AIモデルの集中度マップにペナルティを適用する。
    """
    try:
        print(f"[{user_id}] スキップフィードバック学習ジョブを開始します (タスクID: {task_id})。")
        ai_model_obj = load_ai_model(user_id)

        # ISO文字列をdatetimeオブジェクトに変換し、スロットインデックスを計算
        start_utc = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        end_utc = datetime.fromisoformat(end_time_iso.replace('Z', '+00:00'))

        start_time_jst = start_utc.astimezone(JST)
        end_time_jst = end_utc.astimezone(JST)

        # 現在のJST時刻を基準に、今週の月曜0時を計算 (ai_logic.pyのSchedulerEnvと同じロジック)
        now_jst = datetime.now(JST)
        start_of_week = now_jst - timedelta(days=now_jst.weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=JST) # tzinfo=JSTを明示

        start_delta_seconds = max(0, (start_time_jst - start_of_week).total_seconds())
        end_delta_seconds = max(0, (end_time_jst - start_of_week).total_seconds())

        start_slot = int(start_delta_seconds / 1800)
        end_slot = int(end_delta_seconds / 1800)

        ai_model_obj.apply_skip_feedback(start_slot, end_slot)
        save_ai_model(user_id, ai_model_obj)

        print(f"[{user_id}] スキップフィードバック学習ジョブが完了し、モデルを保存しました。")

    except Exception as e:
        print(f"[{user_id}] スキップフィードバック学習ジョブでエラーが発生しました: {e}")
        import traceback
        traceback.print_exc()   

@app.route('/suggest-slot', methods=['POST', 'OPTIONS'])
def suggest_slot_endpoint():
    if request.method == 'OPTIONS': return jsonify(success=True)
    
    data = request.get_json()

    print("--- フロントエンドから受信した生データ ---")
    print(data)
    print("------------------------------------")
    
    if not data or 'userId' not in data or 'task' not in data:
        return jsonify({"error": "必須データが不足しています"}), 400
    
    user_id = data['userId']
    ai_model = load_ai_model(user_id)
    
    tasks_to_consider = data.get('uncompletedTasks', []) + [data['task']]
    
    rejected_slot_data = data.get('rejectedSlot')

    tasks, ng_zones = prepare_inputs_from_react(
        tasks_to_consider, 
        data.get('unavailableSlots', []), 
        data.get('existingTasks', []),
        rejected_slot=rejected_slot_data 
    )
    
    if not tasks:
        return jsonify({"error": "提案対象のタスクが見つかりませんでした"}), 400
    
    target_task = tasks[-1]

    result = suggest_best_slot(target_task, ng_zones, ai_model)
    
    if result and result.get("suggestion"):
        suggestion_data = result["suggestion"]
        suggestion_data["taskId"] = target_task.id
        suggestion_data["title"] = target_task.name
        return jsonify(suggestion_data)
    else:
        reason = result.get("reason", "不明なエラーにより提案できませんでした。")
        return jsonify({"error": reason}), 404

@app.route('/feedback', methods=['POST'])
def feedback_endpoint():
    """
    タスク完了時のフィードバックを受け取り、AIモデルの学習ジョブを"登録"するAPI。
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400
            
        user_id = data.get('userId')
        start_time_iso = data.get('startTime')
        end_time_iso = data.get('endTime')
        rating = data.get('concentrationRating')
        react_tasks = data.get('react_tasks', [])
        unavailable_slots = data.get('unavailableSlots', [])
        existing_tasks = data.get('existingTasks', [])

        if not all([user_id, start_time_iso, end_time_iso, rating is not None]):
            return jsonify({"error": "必須データ(userId, startTime, endTime, rating)が不足しています"}), 400
        
        job_id = f'feedback_learning_{user_id}_{datetime.now().timestamp()}'
        scheduler.add_job(
            id=job_id,
            func=learn_from_feedback_and_save,
            trigger='date', 
            args=[user_id, start_time_iso, end_time_iso, rating, react_tasks, unavailable_slots, existing_tasks]
        )
        
        print(f"[{user_id}] フィードバック学習ジョブ (ID: {job_id}) を登録しました。")
        
        return jsonify({"success": True, "message": "フィードバックを受け付けました。AIがバックグラウンドで学習します。"})

    except Exception as e:
        print(f"フィードバック受付エラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500
@app.route('/skip-feedback', methods=['POST'])
def skip_feedback_endpoint():
    """
    期限切れタスクのスキップフィードバックを受け取り、AIモデルに負の報酬を適用するAPI。
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400

        user_id = data.get('userId')
        task_id = data.get('taskId') # タスクIDも受け取る (ログ用など)
        start_time_iso = data.get('startTime')
        end_time_iso = data.get('endTime')

        if not all([user_id, task_id, start_time_iso, end_time_iso]):
            return jsonify({"error": "必須データ(userId, taskId, startTime, endTime)が不足しています"}), 400

        job_id = f'skip_feedback_learning_{user_id}_{datetime.now().timestamp()}'
        scheduler.add_job(
            id=job_id,
            func=apply_skip_feedback_and_save,
            trigger='date',
            args=[user_id, task_id, start_time_iso, end_time_iso]
        )

        print(f"[{user_id}] スキップフィードバック学習ジョブ (ID: {job_id}) を登録しました。")

        return jsonify({"success": True, "message": "スキップフィードバックを受け付けました。AIがバックグラウンドで学習します。"})

    except Exception as e:
        print(f"スキップフィードバック受付エラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500

@app.route('/reject-suggestion', methods=['POST'])
def reject_suggestion_endpoint():
    """
    AIの提案が拒否されたフィードバックを受け取り、
    該当する時間スロットのQ値を直接引き下げるAPI。
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400

        user_id = data.get('userId')
        start_time_iso = data.get('startTime') # 拒否された提案の開始時刻

        if not all([user_id, start_time_iso]):
            return jsonify({"error": "必須データ(userId, startTime)が不足しています"}), 400

        # 1. AIモデルをロード
        ai_model_obj = load_ai_model(user_id)

        # 2. 拒否された提案の「時間スロット番号」を計算
        start_utc = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        start_time_jst = start_utc.astimezone(JST)

        now_jst = datetime.now(JST)
        start_of_week = now_jst - timedelta(days=now_jst.weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

        start_delta_seconds = max(0, (start_time_jst - start_of_week).total_seconds())
        rejected_slot = int(start_delta_seconds / 1800) % TOTAL_SLOTS

        # 3. AIモデルにフィードバックを適用 (新しいapply_rejection_feedbackを呼び出す)
        # 状態は常に0と仮定 (バンディット問題)
        ai_model_obj.apply_rejection_feedback(0, rejected_slot, REJECTION_PENALTY)

        # 4. 更新されたモデルを保存
        save_ai_model(user_id, ai_model_obj)

        print(f"[{user_id}] 提案拒否フィードバックを反映しました。スロット: {rejected_slot}")
        return jsonify({"success": True, "message": "フィードバックを反映しました。"})

    except Exception as e:
        print(f"提案拒否フィードバックエラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500

# --- ユーザー設定 (朝型/夜型) API ---
@app.route('/user-preference/<string:user_id>', methods=['GET'])
def get_user_preference_endpoint(user_id):
    """ユーザーの設定を取得する"""
    try:
        preference = load_user_preference(user_id)
        return jsonify(preference)
    except Exception as e:
        print(f"ユーザー設定の取得エラー: {e}")
        return jsonify({"error": "設定の取得中にエラーが発生しました"}), 500

@app.route('/user-preference/<string:user_id>', methods=['POST'])
def save_user_preference_endpoint(user_id):
    """ユーザーの設定を保存する"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "データがありません"}), 400
        
        save_user_preference(user_id, data)

        return jsonify({"success": True, "message": "設定を保存しました"})
    except Exception as e:
        print(f"ユーザー設定の保存エラー: {e}")
        return jsonify({"error": "設定の保存中にエラーが発生しました"}), 500


# --- タスク管理API ---
@app.route('/tasks/<string:user_id>', methods=['GET'])
def get_tasks_endpoint(user_id):
    """ユーザーのタスクリストを取得するAPI"""
    try:
        tasks = load_user_tasks(user_id)
        return jsonify(tasks)
    except Exception as e:
        return jsonify({"error": "タスクの取得中にエラーが発生しました"}), 500

@app.route('/tasks', methods=['POST'])
def add_task_endpoint():
    """新しいタスクを追加するAPI"""
    try:
        data = request.get_json()
        user_id = data.get('userId')
        task_data = data.get('task')
        if not user_id or not task_data:
            return jsonify({"error": "userIdとtaskは必須です"}), 400

        tasks = load_user_tasks(user_id)
        import uuid
        task_data['id'] = str(uuid.uuid4())
        tasks.append(task_data)
        save_user_tasks(user_id, tasks)
        return jsonify({"success": True, "message": "タスクを追加しました", "task": task_data})
    except Exception as e:
        return jsonify({"error": "タスクの追加中にエラーが発生しました"}), 500

@app.route('/tasks/<string:user_id>/<string:task_id>', methods=['PUT'])
def update_task_endpoint(user_id, task_id):
    """既存のタスクを更新するAPI"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400

        tasks = load_user_tasks(user_id)
        found = False
        for i, task in enumerate(tasks):
            if task['id'] == task_id:
                # Noneでない値だけを更新する
                for key, value in data.items():
                    if value is not None:
                        tasks[i][key] = value
                found = True
                break
        
        if not found:
            return jsonify({"error": "指定されたタスクが見つかりません"}), 404

        save_user_tasks(user_id, tasks)
        return jsonify({"success": True, "message": "タスクを更新しました"})
    except Exception as e:
        return jsonify({"error": "タスクの更新中にエラーが発生しました"}), 500

@app.route('/tasks/<string:user_id>/<string:task_id>', methods=['DELETE'])
def delete_task_endpoint(user_id, task_id):
    """タスクを削除するAPI"""
    try:
        tasks = load_user_tasks(user_id)
        initial_len = len(tasks)
        tasks = [task for task in tasks if task['id'] != task_id]
        
        if len(tasks) == initial_len:
            return jsonify({"error": "指定されたタスクが見つかりません"}), 404

        save_user_tasks(user_id, tasks)
        return jsonify({"success": True, "message": "タスクを削除しました"})
    except Exception as e:
        return jsonify({"error": "タスクの削除中にエラーが発生しました"}), 500

# --- 固定の予定管理API ---
@app.route('/unavailable-slots/<string:user_id>', methods=['GET'])
def get_unavailable_slots_endpoint(user_id):
    try:
        slots = load_unavailable_slots(user_id)
        return jsonify(slots)
    except Exception as e:
        return jsonify({"error": "固定の予定の取得中にエラーが発生しました"}), 500

@app.route('/unavailable-slots', methods=['POST'])
def add_unavailable_slot_endpoint():
    try:
        data = request.get_json()
        user_id = data.get('userId')
        slot_data = data.get('slot')
        if not user_id or not slot_data:
            return jsonify({"error": "userIdとslotは必須です"}), 400

        slots = load_unavailable_slots(user_id)
        import uuid
        slot_data['id'] = str(uuid.uuid4())
        slots.append(slot_data)
        save_unavailable_slots(user_id, slots)
        return jsonify({"success": True, "message": "固定の予定を追加しました", "slotId": slot_data['id']})
    except Exception as e:
        print(f"固定の予定の追加中に予期せぬエラー: {e}")
        return jsonify({"error": "固定の予定の追加中にエラーが発生しました"}), 500

@app.route('/unavailable-slots/<string:user_id>/<string:slot_id>', methods=['DELETE'])
def delete_unavailable_slot_endpoint(user_id, slot_id):
    try:
        slots = load_unavailable_slots(user_id)
        initial_len = len(slots)
        slots = [slot for slot in slots if slot['id'] != slot_id]
        
        if len(slots) == initial_len:
            return jsonify({"error": "指定された固定の予定が見つかりません"}), 404

        save_unavailable_slots(user_id, slots)
        return jsonify({"success": True, "message": "固定の予定を削除しました"})
    except Exception as e:
        return jsonify({"error": "固定の予定の削除中にエラーが発生しました"}), 500

@app.route('/reset-model/<string:user_id>', methods=['POST'])
def reset_model_endpoint(user_id):
    """ユーザーのAI学習モデルと設定を削除（リセット）する"""
    try:
        model_path = os.path.join(AI_MODELS_DIR, f'{user_id}.json')
        pref_path = os.path.join(USER_PREFERENCES_DIR, f'{user_id}_preference.json')

        # AIモデルファイルの削除
        if os.path.exists(model_path):
            os.remove(model_path)
            print(f"[{user_id}] AIモデルがユーザーのリクエストによりリセットされました。")

        #ユーザー設定ファイルの削除
        if os.path.exists(pref_path):
            os.remove(pref_path)
            print(f"[{user_id}] ユーザー設定がリセットされました。")
            
        return jsonify({"success": True, "message": "学習データと設定がリセットされました。"})

    except Exception as e:
        print(f"AIモデルと設定のリセット中にエラー発生: {e}")
        return jsonify({"error": "リセット処理中にエラーが発生しました。"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
