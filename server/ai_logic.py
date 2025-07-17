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
TOTAL_SLOTS_CONSIDERED_FOR_NG = TOTAL_SLOTS * 2 # 提案検索範囲を2週間に
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

    def apply_rejection_feedback(self, state, action_index, penalty):
        """提案が拒否されたフィードバックを適用し、特定のQ値を直接更新する"""
        if not (0 <= action_index < self.num_actions):
            return
        
        old_q_value = self.q_table[state][action_index]
        self.q_table[state][action_index] += penalty
        print(f"\n[フィードバック適用] 拒否された提案(state:{state}, action:{action_index})にペナルティ適用。")
        print(f"  - Q値を更新: {old_q_value:.2f} -> {self.q_table[state][action_index]:.2f}")

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


# --- 4. データ変換層 ---
def prepare_inputs_from_react(react_tasks, unavailable_slots=[], existing_tasks=[], for_learning=False):
    # --- ★ここからデバッグ★ ---
    print("\n" + "="*20)
    print("--- NGゾーン計算デバッグ開始 ---")
    print(f"入力された固定予定(unavailable_slots): {json.dumps(unavailable_slots, indent=2, ensure_ascii=False)}")
    # --- ★ここまでデバッグ★ ---

    tasks_list = []
    # ( ... tasks_listを作成するロジックはそのまま ... )
    for task_data in react_tasks:
        if not (task_data.get('estimatedTime') and int(task_data['estimatedTime']) > 0):
            continue
        is_target_task = for_learning or ((not task_data.get('completed', False) and not task_data.get('start')) or task_data.get('rescheduled', False))
        if is_target_task:
            tasks_list.append(Task(id=task_data.get('id', 'temp-id'), name=task_data.get('title', '無題'), required_slots=-(-int(task_data['estimatedTime']) // 30), deadline_str=task_data.get('deadline'), rescheduled=task_data.get('rescheduled', False)))


    ng_zones = set()
    now_jst = datetime.now(JST)
    start_of_week = now_jst - timedelta(days=now_jst.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

    # ( ... NGゾーンを計算するロジックはそのまま ... )
    for slot in unavailable_slots:
        for day_str in slot.get('dayOfWeek', []):
            try:
                day_of_week_int = int(day_str)
                for day_offset in range(DAYS_IN_WEEK):
                    target_date = start_of_week.date() + timedelta(days=day_offset)
                    python_weekday = (target_date.weekday() + 1) % 7
                    if python_weekday == day_of_week_int:
                        start_h, start_m = map(int, slot['startTime'].split(':'))
                        end_h, end_m = map(int, slot['endTime'].split(':'))
                        start_slot_of_day = start_h * 2 + start_m // 30
                        end_slot_of_day = end_h * 2 + end_m // 30
                        base_slot_index = day_offset * SLOTS_PER_DAY
                        for s in range(start_slot_of_day, end_slot_of_day):
                            ng_zones.add(base_slot_index + s)
            except (ValueError, KeyError):
                pass

    for task in existing_tasks:
        start_str, end_str = task.get('start'), task.get('end')
        if start_str and end_str:
            try:
                start_time_utc = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                end_time_utc = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
                start_time_jst = start_time_utc.astimezone(JST)
                end_time_jst = end_time_utc.astimezone(JST)
                start_delta = (start_time_jst - start_of_week).total_seconds()
                end_delta = (end_time_jst - start_of_week).total_seconds()
                if start_delta >= 0:
                    start_slot = int(start_delta / 1800)
                    end_slot = int(end_delta / 1800)
                    for s in range(start_slot, end_slot):
                        if 0 <= s < TOTAL_SLOTS:
                            ng_zones.add(s)
            except (ValueError, TypeError):
                pass
    
    #ここから変更しみず
    # ReactのgetDay()は日曜=0, 月曜=1, ..., 土曜=6
    # Pythonのweekday()は月曜=0, 火曜=1, ..., 日曜=6
    # 変換マップ: Reactの曜日インデックス -> Pythonの曜日インデックス
    react_to_python_weekday_map = {
        0: 6, # 日曜
        1: 0, # 月曜
        2: 1, # 火曜
        3: 2, # 水曜
        4: 3, # 木曜
        5: 4, # 金曜
        6: 5  # 土曜
    }

    for slot in unavailable_slots:
        for day_str in slot.get('dayOfWeek', []):
            try:
                react_weekday_int = int(day_str)
                python_target_weekday = react_to_python_weekday_map.get(react_weekday_int)
                
                if python_target_weekday is None:
                    print(f"警告: 不明な曜日インデックス '{react_weekday_int}' が検出されました。スキップします。")
                    continue

                start_h, start_m = map(int, slot['startTime'].split(':'))
                end_h, end_m = map(int, slot['endTime'].split(':'))

                start_slot_of_day = (start_h * 60 + start_m) // 30
                end_slot_of_day = (end_h * 60 + end_m) // 30
                
                # 変更: 終了時刻の扱いの改善
                # 終了時刻が00分の場合、その前の30分スロットまでとする（例: 10:00 -> 9:30まで）
                # ただし、00:00-00:00 のような指定は考慮しない
                if end_m == 0 and end_h != 0:
                    end_slot_of_day -= 1
                # 23:59 の場合、その日の最後のスロット (47) を含むように調整
                if end_h == 23 and end_m == 59:
                    end_slot_of_day = SLOTS_PER_DAY - 1 # 47

                # 変更: 過去1週間と未来1週間（合計2週間分）を考慮してNGゾーンを設定
                for week_offset in range(-1, 2): # 前週(-1), 今週(0), 来週(1)
                    for day_offset_in_week in range(DAYS_IN_WEEK):
                        # Pythonのweekday()と一致する曜日のみ処理
                        if day_offset_in_week == python_target_weekday:
                            # 週の始まりからの絶対スロットインデックスの基点を計算
                            # ここで TOTAL_SLOTS * 2 の範囲は、前週から来週までをカバーするため
                            base_slot_index = (week_offset * DAYS_IN_WEEK + day_offset_in_week) * SLOTS_PER_DAY
                            
                            # 日をまたぐ設定 (例: 22:00 - 02:00) の場合
                            if end_slot_of_day <= start_slot_of_day:
                                # 開始時刻からその日の終わりまで
                                for s in range(start_slot_of_day, SLOTS_PER_DAY):
                                    absolute_slot = base_slot_index + s
                                    if 0 <= absolute_slot < TOTAL_SLOTS * 2: 
                                        ng_zones.add(absolute_slot)
                                # 翌日の開始から終了時刻まで
                                next_day_base_slot_index = (week_offset * DAYS_IN_WEEK + day_offset_in_week + 1) * SLOTS_PER_DAY
                                for s in range(0, end_slot_of_day + 1): # +1 で終了スロットを含むように修正
                                    absolute_slot = next_day_base_slot_index + s
                                    if 0 <= absolute_slot < TOTAL_SLOTS * 2:
                                        ng_zones.add(absolute_slot)
                            else: # 日をまたがない場合
                                for s in range(start_slot_of_day, end_slot_of_day + 1): # 変更: +1 で終了スロットを含む
                                    absolute_slot = base_slot_index + s
                                    if 0 <= absolute_slot < TOTAL_SLOTS * 2:
                                        ng_zones.add(absolute_slot)
            except (ValueError, KeyError) as e:
                print(f"固定予定のパースエラー: {e}, slot: {slot}")

    # 変更: 既に配置済みのタスクをNGゾーンに追加するロジック全体
    for task in existing_tasks:
        start_str = task.get('start')
        end_str = task.get('end')

        if start_str and end_str:
            try:
                start_time_utc = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                end_time_utc = datetime.fromisoformat(end_str.replace('Z', '+00:00'))

                start_time_jst = start_time_utc.astimezone(JST)
                end_time_jst = end_time_utc.astimezone(JST)

                start_delta_seconds = (start_time_jst - start_of_week).total_seconds()
                end_delta_seconds = (end_time_jst - start_of_week).total_seconds()

                if start_delta_seconds >= 0:
                    start_slot = int(start_delta_seconds / 1800)
                    end_slot = int(end_delta_seconds / 1800)
                    
                    for s in range(start_slot, end_slot): # end_slotは含まれないのでこれでOK
                        if 0 <= s < TOTAL_SLOTS: # TOTAL_SLOTSは1週間分なので、これを超えないように
                            ng_zones.add(s)
            except (ValueError, TypeError) as e:
                print(f"既存タスクの日時パースエラー: {e}, task: {task}")
    

    return tasks_list, sorted(list(ng_zones))#ここまで


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