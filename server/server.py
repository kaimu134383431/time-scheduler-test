from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

# 上記の `ai_logic.py` から必要な関数とクラスをインポート
from ai_logic import AIModel, Task, prepare_inputs_from_react, suggest_best_slot, run_background_learning

# --- Firebase Admin SDKの初期化 ---
# 実行環境に合わせてサービスアカウントキーのパスを指定してください。
# CodeSandboxのSecrets機能などを使うのが安全です。
try:
    cred = credentials.Certificate("path/to/your/serviceAccountKey.json") 
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Firebaseの初期化に失敗しました: {e}")
    db = None


# --- Flaskアプリケーションの準備 ---
app = Flask(__name__)
CORS(app) # 全てのエンドポイントでCORSを許可

# --- APIエンドポイントの定義 ---

@app.route('/suggest-slot', methods=['POST'])
def suggest_slot_endpoint():
    """
    単一のタスクに最適な日時を提案するAPI
    """
    if not db:
        return jsonify({"error": "データベース接続エラー"}), 500

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400

        # フロントエンドから必要な情報を取得
        user_id = data.get('userId')
        task_data = data.get('task') # AIに提案してほしい単一のタスク情報
        unavailable_slots = data.get('unavailableSlots', [])
        
        if not user_id or not task_data:
            return jsonify({"error": "userIdとtaskは必須です"}), 400

        # FirestoreからユーザーのAIモデルを読み込む
        model_doc_ref = db.collection('ai_models').document(user_id)
        model_doc = model_doc_ref.get()
        ai_model = AIModel(model_doc.to_dict() if model_doc.exists else None)
        
        # 入力データをAIが使える形式に変換
        target_task, ng_zones = prepare_inputs_from_react([task_data], unavailable_slots)
        
        if not target_task:
            return jsonify({"error": "提案対象のタスクがありません"}), 400

        # 最適なスロットを提案
        suggestion = suggest_best_slot(target_task[0], ng_zones, ai_model)

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
    if not db:
        return jsonify({"error": "データベース接続エラー"}), 500
        
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "リクエストデータがありません"}), 400
            
        user_id = data.get('userId')
        completion_time_iso = data.get('completionTime')
        rating = data.get('concentrationRating')

        if not all([user_id, completion_time_iso, rating]):
            return jsonify({"error": "userId, completionTime, concentrationRatingは必須です"}), 400
        
        # Firestoreからモデルを読み込む
        model_doc_ref = db.collection('ai_models').document(user_id)
        model_doc = model_doc_ref.get()
        ai_model = AIModel(model_doc.to_dict() if model_doc.exists else None)
        
        # フィードバックを適用
        ai_model.apply_completion_feedback(completion_time_iso, rating)
        
        # 更新されたモデルをFirestoreに保存
        model_doc_ref.set(ai_model.to_json())
        
        return jsonify({"success": True, "message": "フィードバックを学習しました！"})

    except Exception as e:
        print(f"エラー発生: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "サーバー内部でエラーが発生しました"}), 500


if __name__ == '__main__':
    # 開発用サーバーを起動
    # host='0.0.0.0' は、CodeSandboxのような環境で外部からアクセスするために必要
    app.run(host='0.0.0.0', port=5001, debug=True)

