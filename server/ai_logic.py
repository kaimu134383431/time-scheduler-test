import numpy as np
import pandas as pd
from datetime import datetime, timedelta, timezone
import random
from collections import defaultdict
import json

# JST (日本標準時) タイムゾーンオブジェクトを定義
JST = timezone(timedelta(hours=+9))


# --- 1. 設定項目 ---
ALPHA = 0.1
GAMMA = 0.9
EPSILON_START = 1.0
EPSILON_DECAY = 0.999
EPSILON_MIN = 0.05
NUM_BACKGROUND_EPISODES = 200
DAYS_IN_WEEK = 7
SLOTS_PER_DAY = 24
TOTAL_SLOTS = DAYS_IN_WEEK * SLOTS_PER_DAY
#TOTAL_SLOTS_CONSIDERED_FOR_NG = TOTAL_SLOTS * 2 # 提案検索範囲を2週間に
RESCHEDULE_REWARD_BONUS = 25.0
SKIP_PENALTY = -10.0
REJECTION_PENALTY = -2.0
Q_VALUE_WEIGHT = 1.0
CONCENTRATION_WEIGHT = 0.8


# --- 2. AIモデル管理クラス ---
class AIModel:
    """ユーザーの学習モデル（集中度マップとQテーブル）を管理するクラス"""
    def __init__(self, model_data=None):
        if model_data and "concentration_map" in model_data:
            self.concentration_map = np.array(model_data['concentration_map'])
            q_table_from_json = {int(k): np.array(v) for k, v in model_data.get('q_table', {}).items()}
            self.num_actions = model_data.get('num_actions', 0)
            self.q_table = defaultdict(lambda: np.zeros(self.num_actions), q_table_from_json)
        else:
            self._initialize_new_model()

    def _initialize_new_model(self):
        """新規ユーザー用のモデルを初期値で作成"""
        self.concentration_map = np.ones(TOTAL_SLOTS) * 2.5  # 初期集中度
        self.num_actions = TOTAL_SLOTS  # 時間帯はTOTAL_SLOTS
        self.q_table = defaultdict(lambda: np.zeros(self.num_actions))

    def set_num_actions(self, num_actions):
        """Qテーブルのaction数を設定"""
        self.num_actions = num_actions
        self.q_table = defaultdict(lambda: np.zeros(self.num_actions))

    def to_json(self):
        """モデルをJSONシリアライズ可能な辞書に変換"""
        return {
            "concentration_map": self.concentration_map.tolist(),
            "q_table": {str(k): v.tolist() for k, v in self.q_table.items()},
            "num_actions": self.num_actions
        }

    def apply_completion_feedback(self, start_time_iso, end_time_iso, rating):
        """完了報告の情報を元に、集中度マップを更新する"""
        if not start_time_iso or not end_time_iso:
            return
        try:
            start_utc = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
            end_utc = datetime.fromisoformat(end_time_iso.replace('Z', '+00:00'))
            start_time_jst = start_utc.astimezone(JST)
            end_time_jst = end_utc.astimezone(JST)

            now_jst = datetime.now(JST)
            start_of_week = now_jst - timedelta(days=now_jst.weekday())
            start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

            start_delta_seconds = max(0, (start_time_jst - start_of_week).total_seconds())
            end_delta_seconds = max(0, (end_time_jst - start_of_week).total_seconds())
            start_slot = int(start_delta_seconds / 1800)
            end_slot = int(end_delta_seconds / 1800)

            for i in range(start_slot, end_slot):
                if 0 <= i < TOTAL_SLOTS:
                    old_value = self.concentration_map[i]
                    self.concentration_map[i] += ALPHA * (rating - old_value)
        except Exception as e:
            print(f"[フィードバックエラー] 集中度マップ更新中にエラー: {e}")

    def apply_rejection_feedback(self, rejected_slot, penalty):
        """
        提案が拒否されたフィードバックを適用し、
        指定された時間スロットのQ値を直接更新する。
        """
        # 提案時のQテーブル構造 q_table[0][action] に合わせる
        # stateは常に0、actionが時間スロット(rejected_slot)
        state = 0
        action = rejected_slot

        # Qテーブルにそのstateのエントリがなければ作成
        if state not in self.q_table:
            self.q_table[state] = np.zeros(self.num_actions)

        if not (0 <= action < self.num_actions):
            print(f"警告: 範囲外のアクション({action})のため、拒否フィードバックをスキップします。")
            return

        old_q_value = self.q_table[state][action]
        # Q値を直接ペナルティ分だけ減らす
        self.q_table[state][action] += penalty
        print(f"\n[フィードバック適用] 拒否された提案(スロット:{action})にペナルティ適用。")
        print(f"  - Q値を更新: {old_q_value:.2f} -> {self.q_table[state][action]:.2f}")

    def apply_skip_feedback(self, start_slot, end_slot):
        """スキップされた時間帯の集中度マップにペナルティを適用する"""
        print(f"\n[スキップフィードバック適用] スロット {start_slot}-{end_slot} の評価を下げます。")
        for i in range(start_slot, end_slot):
            if 0 <= i < len(self.concentration_map):
                self.concentration_map[i] += SKIP_PENALTY


# --- 3. AIコアロジック（環境とエージェント） ---
class Task:
    """タスク情報を保持するクラス"""
    def __init__(self, id, name, required_slots, deadline_str, rescheduled=False):
        self.id = id
        self.name = name
        self.required_slots = required_slots
        self.remaining_slots = required_slots
        self.rescheduled = rescheduled

        if deadline_str:
            try:
                deadline_utc = datetime.fromisoformat(deadline_str.replace('Z', '+00:00'))
                self.deadline = deadline_utc.astimezone(JST)
            except ValueError:
                naive_deadline = datetime.strptime(deadline_str, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                self.deadline = naive_deadline.replace(tzinfo=JST)
        else:
            self.deadline = datetime.now(JST) + timedelta(days=30)

    def __repr__(self):
        return f"Task(id={self.id}, name={self.name}, remaining={self.remaining_slots})"


class QLearningAgent:
    """Q学習エージェントクラス"""
    def __init__(self, ai_model):
        self.model = ai_model
        self.epsilon = EPSILON_START

    def choose_action(self, possible_actions):
        """バンディット問題におけるアクション（時間帯）を選択"""
        if random.uniform(0, 1) < self.epsilon:
            return random.choice(possible_actions)
        else:
            q_values = self.model.q_table[0]  # 固定の状態から選択（状態遷移がないため）
            max_q = max(q_values[action] for action in possible_actions)
            best_actions = [action for action in possible_actions if q_values[action] == max_q]
            return random.choice(best_actions)

    def learn(self, action, reward):
        """Q学習による学習"""
        old_value = self.model.q_table[0][action]
        new_value = old_value + ALPHA * (reward - old_value)
        self.model.q_table[0][action] = new_value

    def decay_epsilon(self):
        if self.epsilon > EPSILON_MIN:
            self.epsilon *= EPSILON_DECAY

def prepare_inputs_from_react(react_tasks, unavailable_slots=[], existing_tasks=[], for_learning=False):
    """
    Reactからの入力データをAIロジックで扱える形式に変換し、
    NGゾーン（予約不可な時間スロット）を計算する。
    """
    print("\n--- NGゾーン計算 開始 ---")
    print(f"入力: 固定予定(unavailable_slots) = {len(unavailable_slots)}件, 既存タスク(existing_tasks) = {len(existing_tasks)}件")

    # 1. AIが評価するタスクリストを作成
    tasks_list = []
    for task_data in react_tasks:
        # 見積もり時間が存在し、0より大きいタスクのみを対象とする
        if task_data.get('estimatedTime') and int(task_data['estimatedTime']) > 0:
            required_slots = -(-int(task_data['estimatedTime']) // 30)  # 30分単位で切り上げ
            tasks_list.append(Task(
                id=task_data.get('id', 'temp-id'),
                name=task_data.get('title', '無題'),
                required_slots=required_slots,
                deadline_str=task_data.get('deadline'),
                rescheduled=task_data.get('rescheduled', False)
            ))

    # 2. NGゾーンを計算
    ng_zones = set()
    now_jst = datetime.now(JST)
    # 週の始まりを月曜日に固定
    start_of_week = now_jst - timedelta(days=now_jst.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

    # 2-1. Googleカレンダーなどから取得した「既に確保済みのタスク」をNGゾーンに追加
    for task in existing_tasks:
        start_str, end_str = task.get('start'), task.get('end')
        if start_str and end_str:
            try:
                start_utc = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                end_utc = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
                start_jst = start_utc.astimezone(JST)
                end_jst = end_utc.astimezone(JST)

                # 週の始まりからの経過秒数を計算
                start_delta_seconds = (start_jst - start_of_week).total_seconds()
                end_delta_seconds = (end_jst - start_of_week).total_seconds()

                # 今週の範囲内のみを考慮
                if start_delta_seconds >= 0:
                    start_slot = int(start_delta_seconds / 1800)
                    end_slot = int(end_delta_seconds / 1800)
                    for s in range(start_slot, end_slot):
                        if 0 <= s < TOTAL_SLOTS:
                            ng_zones.add(s)
            except (ValueError, TypeError) as e:
                print(f"既存タスクの日時パースエラー: {e}, task: {task}")


    # 2-2. ユーザーが設定した「毎週の固定予定」をNGゾーンに追加
    # Reactの曜日 (日曜=0) -> Pythonの曜日 (月曜=0) への変換マップ
    react_to_python_weekday_map = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }

    for slot in unavailable_slots:
        try:
            start_h, start_m = map(int, slot['startTime'].split(':'))
            end_h, end_m = map(int, slot['endTime'].split(':'))
            start_slot_of_day = (start_h * 60 + start_m) // 30
            end_slot_of_day = (end_h * 60 + end_m) // 30

            for day_str in slot.get('dayOfWeek', []):
                react_weekday = int(day_str)
                python_weekday = react_to_python_weekday_map.get(react_weekday)
                if python_weekday is None:
                    continue
                
                # その曜日の00:00からのスロットインデックスを計算
                base_slot_index = python_weekday * SLOTS_PER_DAY
                for s_offset in range(start_slot_of_day, end_slot_of_day):
                    ng_zones.add(base_slot_index + s_offset)

        except (ValueError, KeyError) as e:
            print(f"固定予定のパースエラー: {e}, slot: {slot}")

    sorted_ng_zones = sorted(list(ng_zones))
    print(f"計算結果: NGゾーンは {len(sorted_ng_zones)} スロット")
    # print(f"NGスロット詳細: {sorted_ng_zones}") # デバッグ用に詳細を見たい場合はコメントアウトを外す
    print("--- NGゾーン計算 終了 ---")

    return tasks_list, sorted_ng_zones

# --- 4. 実行ロジック ---
def suggest_best_slot(target_task, ng_zones, ai_model):
    """最適な時間帯を提案する"""
    possible_actions = [i for i in range(TOTAL_SLOTS) if i not in ng_zones]
    
    agent = QLearningAgent(ai_model)
    best_slot = agent.choose_action(possible_actions)
    
    concentration_score = ai_model.concentration_map[best_slot]
    reward = concentration_score  # 集中度が報酬となる
    
    agent.learn(best_slot, reward)
    agent.decay_epsilon()

    start_time = datetime.now(JST) + timedelta(minutes=30 * best_slot)
    end_time = start_time + timedelta(minutes=30 * target_task.required_slots)
    
    return {"suggestion": {"taskId": target_task.id, "title": target_task.name, "start": start_time.isoformat(), "end": end_time.isoformat()}, "reason": None}


def learning(all_tasks, ng_zones, saved_model_data=None):
    """AIモデルの学習"""
    ai_model = AIModel(saved_model_data)
    
    for task in all_tasks:
        suggest_best_slot(task, ng_zones, ai_model)
    
    return ai_model.to_json()