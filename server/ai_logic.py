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
DAYS_IN_WEEK = 7
SLOTS_PER_DAY = 48
TOTAL_SLOTS = DAYS_IN_WEEK * SLOTS_PER_DAY
TOTAL_SLOTS_CONSIDERED_FOR_NG = TOTAL_SLOTS * 2 # 提案検索範囲を2週間に
SKIP_PENALTY = -10.0
REJECTION_PENALTY = -2.0

# --- 2. AIモデル管理クラス ---
class AIModel:
    def __init__(self, model_data=None):
        if model_data and "concentration_map" in model_data:
            self.concentration_map = np.array(model_data['concentration_map'])
            q_table_from_json = {int(k): np.array(v) for k, v in model_data.get('q_table', {}).items()}
            self.num_actions = model_data.get('num_actions', 0)
            self.q_table = defaultdict(lambda: np.zeros(self.num_actions), q_table_from_json)
        else:
            self._initialize_new_model()

    def _initialize_new_model(self):
        self.concentration_map = np.ones(TOTAL_SLOTS) * 2.5
        self.num_actions = 0
        self.q_table = defaultdict(lambda: np.zeros(0))

    def set_num_actions(self, num_actions):
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
        return {
            "concentration_map": self.concentration_map.tolist(),
            "q_table": {str(k): v.tolist() for k, v in self.q_table.items()},
            "num_actions": self.num_actions
        }

    def apply_completion_feedback(self, start_time_iso, end_time_iso, rating):
        if not start_time_iso or not end_time_iso: return
        try:
            start_utc = datetime.fromisoformat(start_time_iso.replace('Z', '+00:00'))
            end_utc = datetime.fromisoformat(end_time_iso.replace('Z', '+00:00'))
            start_time_jst = start_utc.astimezone(JST)
            end_time_jst = end_utc.astimezone(JST)
            now_jst = datetime.now(JST)
            start_of_week = (now_jst - timedelta(days=now_jst.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
            start_slot = int(max(0, (start_time_jst - start_of_week).total_seconds()) / 1800)
            end_slot = int(max(0, (end_time_jst - start_of_week).total_seconds()) / 1800)
            for i in range(start_slot, end_slot):
                map_index = i % TOTAL_SLOTS
                old_value = self.concentration_map[map_index]
                self.concentration_map[map_index] += ALPHA * (rating - old_value)
        except Exception as e:
            print(f"[フィードバックエラー] 集中度マップ更新中にエラー: {e}")

    def apply_rejection_feedback(self, state, action_index, penalty):
        if not (0 <= action_index < self.num_actions): return
        old_q_value = self.q_table[state][action_index]
        self.q_table[state][action_index] += penalty
        print(f"\\n[フィードバック適用] 拒否された提案(state:{state}, action:{action_index})にペナルティ適用。Q値: {old_q_value:.2f} -> {self.q_table[state][action_index]:.2f}")

    def apply_skip_feedback(self, start_slot, end_slot):
        print(f"\\n[スキップフィードバック適用] スロット {start_slot}-{end_slot} の評価を下げます。")
        for i in range(start_slot, end_slot):
            map_index = i % TOTAL_SLOTS
            if 0 <= map_index < len(self.concentration_map):
                self.concentration_map[map_index] += SKIP_PENALTY

# --- AIコアロジック ---
class Task:
    def __init__(self, id, name, required_slots, deadline_str, rescheduled=False):
        self.id, self.name, self.required_slots, self.rescheduled = id, name, required_slots, rescheduled
        self.remaining_slots = required_slots
        if deadline_str:
            try:
                dt_obj = datetime.fromisoformat(deadline_str.replace('Z', '+00:00'))
                self.deadline = dt_obj.astimezone(JST)
            except ValueError:
                try:
                    naive_deadline = datetime.strptime(deadline_str, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                    self.deadline = naive_deadline.replace(tzinfo=JST)
                except ValueError: self.deadline = datetime.now(JST) + timedelta(days=30)
        else: self.deadline = datetime.now(JST) + timedelta(days=30)

class SchedulerEnv:
    def __init__(self, tasks, ng_zones, concentration_map):
        self.tasks_master, self.ng_zones, self.concentration_map = tasks, ng_zones, concentration_map
        now_in_jst = datetime.now(JST)
        self.start_time = (now_in_jst - timedelta(days=now_in_jst.weekday())).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=JST)
        self.reset()

    def reset(self):
        self.tasks = [Task(t.id, t.name, t.required_slots, t.deadline.isoformat() if t.deadline else None, t.rescheduled) for t in self.tasks_master]
        self.schedule, self.current_slot, self.done = ["-"] * TOTAL_SLOTS, 0, False
        return self.current_slot

    def get_possible_actions(self, current_slot):
        possible_actions = [i for i, task in enumerate(self.tasks) if task.remaining_slots > 0 and current_slot + task.remaining_slots <= TOTAL_SLOTS and all((current_slot + j) not in self.ng_zones for j in range(task.remaining_slots))]
        possible_actions.append(len(self.tasks))
        return possible_actions

    def step(self, action_idx):
        reward = 0
        if action_idx == len(self.tasks):
            reward, self.current_slot = -0.1, self.current_slot + 1
        else:
            task = self.tasks[action_idx]
            duration = task.remaining_slots
            reward = sum(self.concentration_map[s % TOTAL_SLOTS] for s in range(self.current_slot, self.current_slot + duration))
            if task.deadline:
                completion_time = self.start_time + timedelta(minutes=30 * (self.current_slot + duration))
                time_until_deadline = task.deadline - completion_time
                if time_until_deadline.total_seconds() < 0: reward -= 50.0
                else: reward += 20.0 * max(0, 1 - (time_until_deadline.total_seconds() / (3600 * 24 * 7.0)))
            if task.rescheduled: reward += RESCHEDULE_REWARD_BONUS
            for i in range(duration): self.schedule[self.current_slot + i] = task.id
            task.remaining_slots, self.current_slot = 0, self.current_slot + duration
        
        all_tasks_done = all(t.remaining_slots <= 0 for t in self.tasks)
        self.done = all_tasks_done or self.current_slot >= TOTAL_SLOTS
        if self.done and not all_tasks_done: reward -= sum(t.remaining_slots for t in self.tasks) * 10.0
        return self.current_slot, reward, self.done

class QLearningAgent:
    def __init__(self, ai_model):
        self.model, self.epsilon = ai_model, EPSILON_START

    def choose_action(self, state, possible_actions):
        if len(possible_actions) <= 1: return self.model.num_actions - 1
        if random.uniform(0, 1) < self.epsilon: return random.choice(possible_actions)
        q_values = self.model.q_table[state]
        valid_q_values = {a: q_values[a] for a in possible_actions if a < len(q_values)}
        if not valid_q_values: return self.model.num_actions - 1
        max_q = max(valid_q_values.values())
        return random.choice([a for a, q in valid_q_values.items() if q == max_q])

    def learn(self, state, action, reward, next_state, next_possible_actions):
        if action >= self.model.num_actions: return
        old_value = self.model.q_table[state][action]
        next_max_q = 0
        if next_possible_actions:
            q_values_next = self.model.q_table[next_state]
            valid_qs = [q_values_next[na] for na in next_possible_actions if na < len(q_values_next)]
            if valid_qs: next_max_q = max(valid_qs)
        new_value = old_value + ALPHA * (reward + GAMMA * next_max_q - old_value)
        self.model.q_table[state][action] = new_value

    def decay_epsilon(self):
        if self.epsilon > EPSILON_MIN: self.epsilon *= EPSILON_DECAY

# --- データ変換層 & 実行ロジック ---
def prepare_inputs_from_react(react_tasks, unavailable_slots=[], existing_tasks=[], for_learning=False):
    tasks_list = []
    for task_data in react_tasks:
        if not (task_data.get('estimatedTime') and int(task_data['estimatedTime']) > 0): continue
        is_target = for_learning or ((not task_data.get('completed')) and (not task_data.get('start') or task_data.get('rescheduled')))
        if is_target:
            tasks_list.append(Task(id=task_data.get('id', 'temp-id'), name=task_data.get('title', '無題'), required_slots=-(-int(task_data['estimatedTime']) // 30), deadline_str=task_data.get('deadline'), rescheduled=task_data.get('rescheduled', False)))

    ng_zones = set()
    now_jst = datetime.now(JST)
    start_of_week = (now_jst - timedelta(days=now_jst.weekday())).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=JST)
    react_to_python_weekday_map = {0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}

    for slot_data in unavailable_slots:
        for day_str in slot_data.get('dayOfWeek', []):
            try:
                python_target_weekday = react_to_python_weekday_map.get(int(day_str))
                if python_target_weekday is None: continue
                start_h, start_m = map(int, slot_data['startTime'].split(':'))
                end_h, end_m = map(int, slot_data['endTime'].split(':'))
                start_slot_day = (start_h * 60 + start_m) // 30
                end_slot_day = (end_h * 60 + end_m) // 30
                if end_m == 0 and start_slot_day != end_slot_day: end_slot_day -= 1
                
                for week_offset in range(-1, 2):
                    for day_offset in range(DAYS_IN_WEEK):
                        if day_offset == python_target_weekday:
                            base_slot = (week_offset * DAYS_IN_WEEK + day_offset) * SLOTS_PER_DAY
                            for s_offset in range(start_slot_day, end_slot_day + 1):
                                ng_zones.add(base_slot + s_offset)
            except (ValueError, KeyError): continue

    for task in existing_tasks:
        start_str, end_str = task.get('start'), task.get('end')
        if start_str and end_str:
            try:
                start_time_jst = datetime.fromisoformat(start_str.replace('Z', '+00:00')).astimezone(JST)
                end_time_jst = datetime.fromisoformat(end_str.replace('Z', '+00:00')).astimezone(JST)
                start_delta = (start_time_jst - start_of_week).total_seconds()
                end_delta = (end_time_jst - start_of_week).total_seconds()
                for s in range(int(start_delta / 1800), int(end_delta / 1800)):
                    ng_zones.add(s)
            except (ValueError, TypeError): continue
    return tasks_list, sorted(list(ng_zones))

def suggest_best_slot(target_task, uncompleted_tasks, ng_zones, ai_model):
    all_tasks = uncompleted_tasks + [target_task]
    num_actions = len(all_tasks) + 1
    ai_model.set_num_actions(num_actions)
    target_action_index = len(all_tasks) - 1
    best_slot, max_score, duration = -1, -float('inf'), target_task.required_slots
    now_jst = datetime.now(JST)
    start_of_week_jst = (now_jst - timedelta(days=now_jst.weekday())).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=JST)
    min_search_slot = int((now_jst - start_of_week_jst).total_seconds() / 1800) + 1
    
    found_placeable_slot, deadline_missed = False, True

    for slot in range(min_search_slot, TOTAL_SLOTS_CONSIDERED_FOR_NG):
        if slot + duration > TOTAL_SLOTS_CONSIDERED_FOR_NG: break
        slot_time_jst = start_of_week_jst + timedelta(minutes=30 * slot)
        if target_task.deadline and target_task.deadline < slot_time_jst: continue
        deadline_missed = False
        if any(slot + j in ng_zones for j in range(duration)): continue
        found_placeable_slot = True
        
        q_value = ai_model.q_table[slot][target_action_index]
        concentration_score = sum(ai_model.concentration_map[s % TOTAL_SLOTS] for s in range(slot, slot + duration))
        final_score = (Q_VALUE_WEIGHT * q_value) + (CONCENTRATION_WEIGHT * concentration_score)
        if target_task.rescheduled: final_score += RESCHEDULE_REWARD_BONUS
        if final_score > max_score:
            max_score, best_slot = final_score, slot
    
    if best_slot != -1:
        start_time = start_of_week_jst + timedelta(minutes=30 * best_slot)
        end_time = start_time + timedelta(minutes=30 * duration)
        return {"suggestion": {"taskId": target_task.id, "title": target_task.name, "start": start_time.isoformat(), "end": end_time.isoformat()}, "reason": None}
    else:
        reason = "固定予定等で、このタスクを入れられる連続した空き時間がありません。" if not deadline_missed and not found_placeable_slot else "締め切りまでに可能な時間がありません。" if deadline_missed else "不明な理由で提案できませんでした。"
        return {"suggestion": None, "reason": reason}

def learning(all_tasks, ng_zones, saved_model_data=None):
    if not all_tasks: return saved_model_data
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