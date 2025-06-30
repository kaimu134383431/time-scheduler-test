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
SLOTS_PER_DAY = 48
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
        self.concentration_map = np.ones(TOTAL_SLOTS) * 2.5
        self.num_actions = 0
        self.q_table = defaultdict(lambda: np.zeros(0))

    def set_num_actions(self, num_actions):
        """タスク数に応じてQテーブルのaction数を確定させ、既存の学習内容を維持する"""
        if self.num_actions != num_actions:
            old_q_table = self.q_table
            self.num_actions = num_actions
            new_q_table = defaultdict(lambda: np.zeros(self.num_actions))

            if old_q_table:
                for state, old_values in old_q_table.items():
                    new_values = np.zeros(self.num_actions)
                    num_to_copy = min(len(old_values), len(new_values))
                    new_values[:num_to_copy] = old_values[:num_to_copy]
                    new_q_table[state] = new_values
            self.q_table = new_q_table

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

class SchedulerEnv:
    """スケジューリング環境を表すクラス"""
    def __init__(self, tasks, ng_zones, concentration_map):
        self.tasks_master = tasks
        self.ng_zones = ng_zones
        now_in_jst = datetime.now(JST)
        self.start_time = now_in_jst - timedelta(days=now_in_jst.weekday())
        self.start_time = self.start_time.replace(hour=0, minute=0, second=0, microsecond=0,tzinfo=JST)#tzinfo=JST引数追加しみず
        self.concentration_map = concentration_map
        self.reset()

    def reset(self):
        self.tasks = [Task(t.id, t.name, t.required_slots, t.deadline.isoformat() if hasattr(t, 'deadline') and t.deadline else None, t.rescheduled) for t in self.tasks_master]
        self.schedule = ["-" for _ in range(TOTAL_SLOTS)]
        self.current_slot = 0
        self.done = False
        return self.current_slot

    def get_possible_actions(self, current_slot):
        possible_actions = []
        for i, task in enumerate(self.tasks):
            if task.remaining_slots > 0:
                duration = task.remaining_slots
                if current_slot + duration <= TOTAL_SLOTS and all(current_slot + j not in self.ng_zones and self.schedule[current_slot + j] == "-" for j in range(duration)):
                    possible_actions.append(i)
        possible_actions.append(len(self.tasks))
        return possible_actions

    def step(self, action_idx):
        reward = 0
        t_len = len(self.tasks)
        if action_idx == t_len:
            reward = -0.1
            self.current_slot += 1
        else:
            task = self.tasks[action_idx]
            duration = task.remaining_slots
            block_slots = range(self.current_slot, self.current_slot + duration)
            reward = sum(self.concentration_map[s] for s in block_slots)

            if task.deadline:
                completion_time = self.start_time + timedelta(minutes=30 * (self.current_slot + duration))
                time_until_deadline = task.deadline - completion_time
                if time_until_deadline.total_seconds() < 0:
                    reward -= 50.0
                else:
                    days_until = time_until_deadline.total_seconds() / (24 * 3600)
                    deadline_bonus = 20.0 * max(0, 1 - (days_until / 7.0))
                    reward += deadline_bonus
            if task.rescheduled:
                reward += RESCHEDULE_REWARD_BONUS
            
            for i in range(duration):
                self.schedule[self.current_slot + i] = task.id
            task.remaining_slots = 0
            self.current_slot += duration

        all_tasks_done = all(t.remaining_slots <= 0 for t in self.tasks)
        self.done = all_tasks_done or self.current_slot >= TOTAL_SLOTS
        if self.done and not all_tasks_done:
            reward -= sum(t.remaining_slots for t in self.tasks) * 10.0
        
        return self.current_slot, reward, self.done

class QLearningAgent:
    """Q学習エージェントクラス"""
    def __init__(self, ai_model):
        self.model = ai_model
        self.epsilon = EPSILON_START

    def choose_action(self, state, possible_actions):
        if len(possible_actions) <= 1:
            return self.model.num_actions - 1
        if random.uniform(0, 1) < self.epsilon:
            return random.choice(possible_actions)
        else:
            q_values = self.model.q_table[state]
            max_q = -np.inf
            for action_index in possible_actions:
                if q_values[action_index] > max_q:
                    max_q = q_values[action_index]
            best_actions = [a for a in possible_actions if q_values[a] == max_q]
            return random.choice(best_actions)

    def learn(self, state, action, reward, next_state, next_possible_actions):
        old_value = self.model.q_table[state][action]
        next_max_q = 0
        if next_possible_actions:
            q_values_next = self.model.q_table[next_state]
            if len(q_values_next) > 0:
                next_max_q = max(q_values_next[na] for na in next_possible_actions)
        
        new_value = old_value + ALPHA * (reward + GAMMA * next_max_q - old_value)
        self.model.q_table[state][action] = new_value

    def decay_epsilon(self):
        if self.epsilon > EPSILON_MIN:
            self.epsilon *= EPSILON_DECAY

# --- 4. データ変換層 ---
# ai_logic.py の prepare_inputs_from_react 関数を修正

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
    
    # --- ★ここからデバッグ★ ---
    # ログが長くなりすぎないよう、最初の50件だけ表示
    print(f"計算後のNGゾーン(一部): {sorted(list(ng_zones))[:50]}...")
    print(f"NGゾーンの総数: {len(ng_zones)}")
    print("--- NGゾーン計算デバッグ終了 ---")
    print("="*20 + "\n")
    # --- ★ここまでデバッグ★ ---

    return tasks_list, list(ng_zones)
    tasks_list = []
    for task_data in react_tasks:
        if not (task_data.get('estimatedTime') and int(task_data['estimatedTime']) > 0):
            continue
        is_target_task = for_learning or ((not task_data.get('completed', False) and not task_data.get('start')) or task_data.get('rescheduled', False))
        if is_target_task:
            tasks_list.append(Task(id=task_data.get('id', 'temp-id'), name=task_data.get('title', '無題'), required_slots=-(-int(task_data['estimatedTime']) // 30), deadline_str=task_data.get('deadline'), rescheduled=task_data.get('rescheduled', False)))

    ng_zones = set()
    now_jst = datetime.now(JST)
    start_of_week = now_jst - timedelta(days=now_jst.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0,tzinfo=JST)#tzinfo=JST引数追加しみず

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

# --- 5. 実行ロジック ---

def suggest_best_slot(target_task, uncompleted_tasks, ng_zones, ai_model):
    """単一タスクに最適な時間枠を提案する（ローリングウィーク対応版）"""
    all_tasks = uncompleted_tasks + [target_task]
    num_actions = len(all_tasks) + 1
    ai_model.set_num_actions(num_actions)
    target_action_index = len(all_tasks) - 1

    best_slot, max_score = -1, -float('inf')
    duration = target_task.required_slots
    
    now_jst = datetime.now(JST)
    start_of_week_jst = (now_jst - timedelta(days=now_jst.weekday())).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=JST)
    
    min_search_slot = int((now_jst - start_of_week_jst).total_seconds() / 1800) + 1
    
    found_placeable_slot = False
    deadline_missed = True

    for slot in range(min_search_slot, TOTAL_SLOTS_CONSIDERED_FOR_NG):
        # 検索範囲の終点も合わせて修正
        if slot + duration > TOTAL_SLOTS_CONSIDERED_FOR_NG:
            break
            
        slot_time_jst = start_of_week_jst + timedelta(minutes=30 * slot)
        if target_task.deadline and target_task.deadline < slot_time_jst:
            continue
        deadline_missed = False

        if any(slot + j in ng_zones for j in range(duration)):
            continue
        found_placeable_slot = True
        
        q_value = ai_model.q_table[slot][target_action_index]
        # 集中度マップは1週間分しかないので、インデックスを剰余で丸める
        concentration_score = sum(ai_model.concentration_map[s % TOTAL_SLOTS] for s in range(slot, slot + duration))
        final_score = (Q_VALUE_WEIGHT * q_value) + (CONCENTRATION_WEIGHT * concentration_score)
        
        if target_task.rescheduled:
            final_score += RESCHEDULE_REWARD_BONUS
        
        if final_score > max_score:
            max_score, best_slot = final_score, slot
    
    if best_slot != -1:
        start_time = start_of_week_jst + timedelta(minutes=30 * best_slot)
        end_time = start_time + timedelta(minutes=30 * duration)
        # 成功時は、suggestion と共に reason: None を返す
        return {"suggestion": {"taskId": target_task.id, "title": target_task.name, "start": start_time.isoformat(), "end": end_time.isoformat()}, "reason": None}
    else:
        # 失敗理由の分析ロジック
        reason = "固定予定等で、このタスクを入れられる連続した空き時間がありません。" if not deadline_missed and not found_placeable_slot else "締め切りまでに可能な時間がありません。" if deadline_missed else "不明な理由で提案できませんでした。"
        return {"suggestion": None, "reason": reason}

def learning(all_tasks, ng_zones, saved_model_data=None):
    """AIモデルの継続的な学習"""
    if not all_tasks:
        return saved_model_data

    ai_model = AIModel(saved_model_data)
    ai_model.set_num_actions(len(all_tasks) + 1)
    
    env = SchedulerEnv(all_tasks, ng_zones, ai_model.concentration_map)
    agent = QLearningAgent(ai_model)

    for _ in range(NUM_BACKGROUND_EPISODES):
        state = env.reset()
        done = False
        while not done:
            possible_actions = env.get_possible_actions(state)
            action = agent.choose_action(state, possible_actions)
            next_state, reward, done = env.step(action)
            next_possible_actions = env.get_possible_actions(next_state)
            agent.learn(state, action, reward, next_state, next_possible_actions)
            state = next_state
    
    agent.decay_epsilon()
    return ai_model.to_json()