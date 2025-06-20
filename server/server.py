from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import firebase_admin
from firebase_admin import credentials, auth, firestore
from datetime import datetime, timedelta
import json # ★追加: jsonモジュールをインポート

# ai_logic.py から必要な関数とクラスをインポート
# （ai_logic.pyの内容は別途必要です）
from ai_logic import AIModel, Task, prepare_inputs_from_react, suggest_best_slot, run_background_learning, TOTAL_SLOTS

# データ保存ディレクトリの定義と作成 (サーバー起動時に確認)
DATA_DIR = 'data'
AI_MODELS_DIR = os.path.join(DATA_DIR, 'ai_models')
USER_TASKS_DIR = os.path.join(DATA_DIR, 'user_tasks')
UNAVAILABLE_SLOTS_DIR = os.path.join(DATA_DIR, 'unavailable_slots') # ★追加: 固定の予定保存用ディレクトリ

# Flaskアプリケーションの準備
# ★修正: FlaskアプリとCORSの設定を一度だけ行います
app = Flask(__name__)
CORS(app) # アプリ全体でCORSを有効にする

@app.before_request
def ensure_data_dirs():
    """リクエスト処理前にデータ保存ディレクトリが存在することを確認"""
    os.makedirs(AI_MODELS_DIR, exist_ok=True)
    os.makedirs(USER_TASKS_DIR, exist_ok=True)
    os.makedirs(UNAVAILABLE_SLOTS_DIR, exist_ok=True) # ★追加: ディレクトリ作成

# --- データ読み書きヘルパー関数 (ファイルベース) ---
def load_ai_model(user_id):
    model_path = os.path.join(AI_MODELS_DIR, f'{user_id}.json')
    if os.path.exists(model_path):
        with open(model_path, 'r', encoding='utf-8') as f:
            model_data = json.load(f)
            return AIModel(model_data)
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

# ★追加: 固定の予定のデータ読み書きヘルパー関数
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
        
# --- APIエンドポイントの定義 ---

@app.route('/suggest-slot', methods=['POST'])
def suggest_slot_endpoint():
    """
    単一のタスクに最適な日時を提案するAPI
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400

        user_id = data.get('userId')
        task_data = data.get('task')
        unavailable_slots = data.get('unavailableSlots', [])
        
        if not user_id or not task_data:
            return jsonify({"error": "userIdとtaskは必須です"}), 400

        ai_model = load_ai_model(user_id)
        
        target_task_list, ng_zones = prepare_inputs_from_react([task_data], unavailable_slots)
        
        if not target_task_list:
            return jsonify({"error": "提案対象のタスクがありません"}), 400

        suggestion = suggest_best_slot(target_task_list[0], ng_zones, ai_model)

        if suggestion:
            return jsonify(suggestion)
        else:
            return jsonify({"error": "提案可能な空き時間が見つかりませんでした"}), 404

    except Exception as e:
        print(f"エラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500

@app.route('/feedback', methods=['POST'])
def feedback_endpoint():
    """
    タスク完了時のフィードバックを受け取り、AIモデルを更新するAPI
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400
            
        user_id = data.get('userId')
        completion_time_iso = data.get('completionTime')
        rating = data.get('concentrationRating')

        if not all([user_id, completion_time_iso, rating]):
            return jsonify({"error": "userId, completionTime, concentrationRatingは必須です"}), 400
        
        ai_model = load_ai_model(user_id)
        
        ai_model.apply_completion_feedback(completion_time_iso, rating)
        
        save_ai_model(user_id, ai_model)
        
        return jsonify({"success": True, "message": "フィードバックを学習しました！"})

    except Exception as e:
        print(f"エラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500

# --- タスク管理API (フロントエンドからの読み書き用) ---
@app.route('/tasks/<string:user_id>', methods=['GET'])
def get_tasks_endpoint(user_id):
    """ユーザーのタスクリストを取得するAPI"""
    try:
        tasks = load_user_tasks(user_id)
        return jsonify(tasks)
    except Exception as e:
        print(f"タスク取得エラー: {e}")
        import traceback
        traceback.print_exc()
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
        task_data['id'] = str(len(tasks) + 1)
        tasks.append(task_data)
        save_user_tasks(user_id, tasks)
        return jsonify({"success": True, "message": "タスクを追加しました", "taskId": task_data['id']})
    except Exception as e:
        print(f"タスク追加エラー: {e}")
        import traceback
        traceback.print_exc()
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
        print(f"タスク更新エラー: {e}")
        import traceback
        traceback.print_exc()
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
        print(f"タスク削除エラー: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "タスクの削除中にエラーが発生しました"}), 500

# ★ここから追加: 固定の予定管理API
@app.route('/unavailable-slots/<string:user_id>', methods=['GET'])
def get_unavailable_slots_endpoint(user_id):
    """ユーザーの固定の予定リストを取得するAPI"""
    try:
        slots = load_unavailable_slots(user_id)
        return jsonify(slots)
    except Exception as e:
        print(f"固定の予定取得エラー: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "固定の予定の取得中にエラーが発生しました"}), 500

@app.route('/unavailable-slots', methods=['POST'])
def add_unavailable_slot_endpoint():
    """新しい固定の予定を追加するAPI"""
    try:
        data = request.get_json()
        user_id = data.get('userId')
        slot_data = data.get('slot')
        if not user_id or not slot_data:
            return jsonify({"error": "userIdとslotは必須です"}), 400

        slots = load_unavailable_slots(user_id)
        slot_data['id'] = str(len(slots) + 1)
        slots.append(slot_data)
        save_unavailable_slots(user_id, slots)
        return jsonify({"success": True, "message": "固定の予定を追加しました", "slotId": slot_data['id']})
    except Exception as e:
        print(f"固定の予定追加エラー: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "固定の予定の追加中にエラーが発生しました"}), 500

@app.route('/unavailable-slots/<string:user_id>/<string:slot_id>', methods=['DELETE'])
def delete_unavailable_slot_endpoint(user_id, slot_id):
    """固定の予定を削除するAPI"""
    try:
        slots = load_unavailable_slots(user_id)
        initial_len = len(slots)
        slots = [slot for slot in slots if slot['id'] != slot_id]
        
        if len(slots) == initial_len:
            return jsonify({"error": "指定された固定の予定が見つかりません"}), 404

        save_unavailable_slots(user_id, slots)
        return jsonify({"success": True, "message": "固定の予定を削除しました"})
    except Exception as e:
        print(f"固定の予定削除エラー: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "固定の予定の削除中にエラーが発生しました"}), 500


if __name__ == '__main__':
    # 開発用サーバーを起動
    # host='0.0.0.0' は、CodeSandboxのような環境で外部からアクセスするために必要
    app.run(host='0.0.0.0', port=5001, debug=True)