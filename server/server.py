# server.py (ファイル保存方式の正しいコード)
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import firebase_admin
from firebase_admin import credentials, auth, firestore
from datetime import datetime, timedelta
import json

from flask_apscheduler import APScheduler

# ai_logic.py から必要な関数とクラスをインポート
from ai_logic import AIModel, Task, prepare_inputs_from_react, suggest_best_slot, learning, TOTAL_SLOTS, REJECTION_PENALTY
from datetime import datetime, timedelta, timezone 
JST = timezone(timedelta(hours=+9))

# データ保存ディレクトリの定義と作成 (サーバー起動時に確認)
DATA_DIR = 'data'
AI_MODELS_DIR = os.path.join(DATA_DIR, 'ai_models')
USER_TASKS_DIR = os.path.join(DATA_DIR, 'user_tasks')
UNAVAILABLE_SLOTS_DIR = os.path.join(DATA_DIR, 'unavailable_slots')

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

# --- データ読み書きヘルパー関数 (ファイルベース) ---
def load_ai_model(user_id):
    model_path = os.path.join(AI_MODELS_DIR, f'{user_id}.json')
    if os.path.exists(model_path):
        with open(model_path, 'r', encoding='utf-8') as f:
            try:
                model_data = json.load(f)
                return AIModel(model_data)
            except json.JSONDecodeError:
                print(f"警告: モデルファイル {model_path} が空または壊れています。新しいモデルを作成します。")
                return AIModel(None)
    return AIModel(None)

def save_ai_model(user_id, ai_model):
    model_path = os.path.join(AI_MODELS_DIR, f'{user_id}.json')
    with open(model_path, 'w', encoding='utf-8') as f:
        json.dump(ai_model.to_json(), f, indent=2, ensure_ascii=False)

def load_user_tasks(user_id):
    tasks_path = os.path.join(USER_TASKS_DIR, f'{user_id}_tasks.json')
    if os.path.exists(tasks_path):
        with open(tasks_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def save_user_tasks(user_id, tasks_list):
    tasks_path = os.path.join(USER_TASKS_DIR, f'{user_id}_tasks.json')
    with open(tasks_path, 'w', encoding='utf-8') as f:
        json.dump(tasks_list, f, indent=2, ensure_ascii=False)

def load_unavailable_slots(user_id):
    slots_path = os.path.join(UNAVAILABLE_SLOTS_DIR, f'{user_id}_unavailable_slots.json')
    if os.path.exists(slots_path):
        with open(slots_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def save_unavailable_slots(user_id, slots_list):
    slots_path = os.path.join(UNAVAILABLE_SLOTS_DIR, f'{user_id}_unavailable_slots.json')
    with open(slots_path, 'w', encoding='utf-8') as f:
        json.dump(slots_list, f, indent=2, ensure_ascii=False)

def learn_from_feedback_and_save(user_id, start_time_iso, end_time_iso, rating, react_tasks, unavailable_slots, existing_tasks):
    """
    フィードバックに基づき、AIモデルの学習と保存を非同期で実行する関数。
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
        # ★修正: start_of_week も aware datetime にする
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
    if not data or 'userId' not in data or 'task' not in data:
        return jsonify({"error": "必須データが不足しています"}), 400
    
    ai_model = load_ai_model(data['userId'])
    tasks, ng_zones = prepare_inputs_from_react(
        data.get('uncompletedTasks', []) + [data['task']], 
        data.get('unavailableSlots', []), 
        data.get('existingTasks', [])
    )
    
    if not tasks:
        return jsonify({"error": "提案対象のタスクが見つかりませんでした"}), 400
    
    target_task = tasks[-1]
    other_tasks = tasks[:-1]

    # ★★★ ここからが修正箇所 ★★★
    # suggest_best_slotは {"suggestion": ..., "reason": ...} という辞書を返す
    result = suggest_best_slot(target_task, other_tasks, ng_zones, ai_model)
    
    # 成功した場合、'suggestion'キーの中身だけを取り出して返す
    if result and result.get("suggestion"):
        # 提案内容にタスクIDとタイトルを追加して返す
        suggestion_data = result["suggestion"]
        suggestion_data["taskId"] = target_task.id
        suggestion_data["title"] = target_task.name
        return jsonify(suggestion_data)
    else:
    # 失敗した場合、'reason'キーの中身をエラーメッセージとして返す
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
    該当するQ値を直接引き下げる軽量なAPI。
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400
            
        user_id = data.get('userId')
        start_time_iso = data.get('startTime')
        react_tasks = data.get('react_tasks', []) 

        if not all([user_id, start_time_iso, react_tasks]):
            return jsonify({"error": "必須データ(userId, startTime, react_tasks)が不足しています"}), 400
        
        # 1. AIモデルをロード
        ai_model_obj = load_ai_model(user_id)
        
        # 2. 拒否された提案の「状態(state)」= スロット番号を計算
        JST = timezone(timedelta(hours=+9))
        start_utc = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        start_time_jst = start_utc.astimezone(JST)
        
        now_jst = datetime.now(JST)
        start_of_week = now_jst - timedelta(days=now_jst.weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
        
        start_delta_seconds = max(0, (start_time_jst - start_of_week).total_seconds())
        rejected_state = int(start_delta_seconds / 1800)

        # 3. 拒否された提案の「行動(action_index)」を特定
        tasks_for_suggestion, _ = prepare_inputs_from_react(react_tasks, [], [], for_learning=False)
        
        if not tasks_for_suggestion:
             return jsonify({"error": "フィードバック対象のタスクが見つかりません"}), 400
        
        rejected_action_index = len(tasks_for_suggestion) - 1

        # 4. AIモデルにフィードバックを適用 (Step 1で修正したメソッドを呼び出し)
        ai_model_obj.apply_rejection_feedback(rejected_state, rejected_action_index, REJECTION_PENALTY)
        
        # 5. 更新されたモデルを保存
        save_ai_model(user_id, ai_model_obj)
        
        return jsonify({"success": True, "message": "フィードバックを反映しました。"})

    except Exception as e:
        print(f"提案拒否フィードバックエラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500
    """
    AIの提案が拒否されたフィードバックを受け取り、AIモデルを学習するAPI
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400

        user_id = data.get('userId')
        start_time_iso = data.get('startTime')
        # end_time_iso, unavailable_slots, existing_tasks はai_logic側で使われないため、ここでは必須としない
        react_tasks = data.get('react_tasks', [])

        if not all([user_id, start_time_iso]): # react_tasks は空の可能性があるのでここで必須チェックしない
            return jsonify({"error": "必須データ(userId, startTime)が不足しています"}), 400

        ai_model_obj = load_ai_model(user_id)

        # prepare_inputs_from_react の呼び出しから、不要な引数を削除
        tasks_for_suggestion, _ = prepare_inputs_from_react(react_tasks, [], [], for_learning=False)

        if not tasks_for_suggestion:
            # 学習対象タスクがない場合は、エラーではなく成功レスポンスを返す
            return jsonify({"success": True, "message": "フィードバックを受け付けました（学習対象タスクなし）"})

        # rejected_state の計算 (JST aware datetimeを使用)
        start_utc = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
        start_time_jst = start_utc.astimezone(JST)
        now_jst = datetime.now(JST)
        # ★修正: start_of_week も aware datetime にする
        start_of_week = now_jst - timedelta(days=now_jst.weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=JST) # tzinfo=JSTを明示

        start_delta_seconds = max(0, (start_time_jst - start_of_week).total_seconds())
        rejected_state = int(start_delta_seconds / 1800)

        # 拒否された行動のインデックスは、通常提案対象のタスクがリストの最後に追加されているため
        rejected_action_index = len(tasks_for_suggestion) - 1

        ai_model_obj.apply_rejection_feedback(rejected_state, rejected_action_index, REJECTION_PENALTY)
        save_ai_model(user_id, ai_model_obj)

        return jsonify({"success": True, "message": "フィードバックを基に再学習しました。"})

    except Exception as e:
        print(f"提案拒否フィードバックエラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500

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
        return jsonify({"success": True, "message": "タスクを追加しました", "taskId": task_data['id']})
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
                tasks[i].update(data)
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
        # このエラーメッセージは本来表示されませんが、念のため残しておきます
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)