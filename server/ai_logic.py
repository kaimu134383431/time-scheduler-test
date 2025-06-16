# このファイルは、これまでの app.py の内容をベースに、
# サーバーから呼び出されるライブラリとして機能するように整理したものです。
# 以前の main() 関数はシミュレーション用のため、ここでは削除されています。

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import random
from collections import defaultdict
import json

# --- 1. 設定項目 ---
ALPHA = 0.1
GAMMA = 0.9
EPSILON_START = 1.0
EPSILON_DECAY = 0.999
EPSILON_MIN = 0.05
NUM_BACKGROUND_EPISODES = 200 # バックグラウンド学習用
DAYS_IN_WEEK = 7
SLOTS_PER_DAY = 48
TOTAL_SLOTS = DAYS_IN_WEEK * SLOTS_PER_DAY
RESCHEDULE_REWARD_BONUS = 25.0
SKIP_PENALTY = -10.0

# --- 2. AIモデル管理クラス ---
class AIModel:
    def __init__(self, model_data=None):
        if model_data and "concentration_map" in model_data:
            self.concentration_map = np.array(model_data['concentration_map'])
            self.q_table = defaultdict(lambda: np.zeros(model_data.get('num_actions', 0)), 
                                       {int(k): np.array(v) for k, v in model_data.get('q_table', {}).items()})
            self.num_actions = model_data.get('num_actions', 0)
        else:
            self._initialize_new_model()

    def _initialize_new_model(self):
        self.concentration_map = np.ones(TOTAL_SLOTS) * 2.5
        self.num_actions = 0
        self.q_table = defaultdict(lambda: np.zeros(0))

    def set_num_actions(self, num_actions):
        if self.num_actions != num_actions:
            self.num_actions = num_actions
            new_q_table = defaultdict(lambda: np.zeros(self.num_actions))
            if hasattr(self, 'q_table'):
                for state, values in self.q_table.items():
                    new_values = np.zeros(self.num_actions)
                    min_len = min(len(values), len(new_values))
                    new_values[:min_len] = values[:min_len]
                    new_q_table[state] = new_values
            self.q_table = new_q_table

    def to_json(self):
        return {
            "concentration_map": self.concentration_map.tolist(),
            "q_table": {str(k): v.tolist() for k, v in self.q_table.items()},
            "num_actions": self.num_actions
        }

    def apply_completion_feedback(self, completion_time_iso, rating):
        """完了報告モーダルの情報を元に集中度マップを更新する"""
        completion_time = datetime.fromisoformat(completion_time_iso.replace('Z', '+00:00'))
        # どの曜日のどの時間かを計算（週の頭を月曜として計算）
        start_of_week = datetime.now() - timedelta(days=datetime.now().weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
        
        delta_seconds = (completion_time - start_of_week).total_seconds()
        
        if delta_seconds >= 0:
            slot_index = int(delta_seconds / 1800) # 30分 = 1800秒
            if 0 <= slot_index < TOTAL_SLOTS:
                print(f"[フィードバック適用] スロット {slot_index} ({completion_time.strftime('%Y-%m-%d %H:%M')}) の評価を {rating} 点で更新。")
                self.concentration_map[slot_index] += ALPHA * (rating - self.concentration_map[slot_index])

# --- 3. AIコアロジック ---
class Task:
    def __init__(self, id, name, required_slots, deadline_str, rescheduled=False):
        self.id, self.name, self.required_slots, self.remaining_slots, self.rescheduled = id, name, required_slots, required_slots, rescheduled
        if deadline_str:
            try:
                self.deadline = datetime.fromisoformat(deadline_str.replace('Z', '+00:00'))
            except ValueError:
                self.deadline = datetime.strptime(deadline_str, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        else: self.deadline = datetime.now() + timedelta(days=30)
    def __repr__(self): return f"Task(id={self.id}, name={self.name}, rescheduled={self.rescheduled}, remaining={self.remaining_slots})"

class SchedulerEnv:
    # ... (このクラスは内部的なので変更なし) ...
    def __init__(self, tasks, ng_zones, start_time, concentration_map):
        self.tasks_master, self.ng_zones, self.start_time, self.concentration_map = tasks, ng_zones, start_time, concentration_map
        self.reset()
    def reset(self):
        self.tasks = [Task(t.id, t.name, t.required_slots, t.deadline.strftime("%Y-%m-%d %H:%M:%S"), t.rescheduled) for t in self.tasks_master]
        self.schedule, self.current_slot, self.done = ["-"] * TOTAL_SLOTS, 0, False
        return self.current_slot
    def get_possible_actions(self, c):
        p_a=[i for i,t in enumerate(self.tasks) if t.remaining_slots>0 and c+t.remaining_slots<=TOTAL_SLOTS and all(c+j not in self.ng_zones and self.schedule[c+j]=="-" for j in range(t.remaining_slots))]; p_a.append(len(self.tasks)); return p_a
    def step(self, a_idx):
        r=0; t_len=len(self.tasks)
        if a_idx==t_len: r, self.current_slot = -0.1, self.current_slot+1
        else:
            t=self.tasks[a_idx]; d=t.remaining_slots; b_s=range(self.current_slot,self.current_slot+d)
            r=sum(self.concentration_map[s] for s in b_s)
            if(t.deadline-(self.start_time+timedelta(minutes=30*self.current_slot))).days<2: r+=10.0
            if t.rescheduled: r+=RESCHEDULE_REWARD_BONUS
            for i in range(d): self.schedule[self.current_slot+i]=t.id
            t.remaining_slots=0; self.current_slot+=d
        done=all(t.remaining_slots<=0 for t in self.tasks) or self.current_slot>=TOTAL_SLOTS
        if done and not all(t.remaining_slots<=0 for t in self.tasks): r-=sum(t.remaining_slots for t in self.tasks)*10.0
        self.done=done; return self.current_slot,r,done

class QLearningAgent:
    # ... (このクラスは内部的なので変更なし) ...
    def __init__(self,ai_model): self.model, self.epsilon = ai_model, EPSILON_START
    def choose_action(self,s,p_a):
        if len(p_a)<=1:return self.model.num_actions-1
        if random.uniform(0,1)<self.epsilon:return random.choice(p_a)
        q_v=self.model.q_table[s];m_q=max(q_v[a] for a in p_a);return random.choice([a for a in p_a if q_v[a]==m_q])
    def learn(self,s,a,r,n_s,n_p_a):
        o_v=self.model.q_table[s][a];n_m_q=max(self.model.q_table[n_s][na] for na in n_p_a) if len(n_p_a)>1 else self.model.q_table[n_s][self.model.num_actions-1]
        self.model.q_table[s][a]=o_v+ALPHA*(r+GAMMA*n_m_q-o_v)
    def decay_epsilon(self):
        if self.epsilon>EPSILON_MIN: self.epsilon*=EPSILON_DECAY


# --- 4. データ変換層 ---
def prepare_inputs_from_react(react_tasks, unavailable_slots=[], sleep_hours=[(0,7)]):
    tasks_list=[]
    for task in react_tasks:
        if not task.get('completed',False) and not task.get('hidden',False) and task.get('estimatedTime',0)>0:
            tasks_list.append(Task(id=task['id'],name=task['title'],required_slots=-(-task['estimatedTime']//30),deadline_str=task['deadline'],rescheduled=task.get('rescheduled',False)))
    ng_zones=set()
    today_weekday=datetime.now().weekday()
    for day_offset in range(DAYS_IN_WEEK):
        for start_h, end_h in sleep_hours:
            for hour in range(start_h, end_h): [ng_zones.add(day_offset*SLOTS_PER_DAY+hour*2+m) for m in [0,1]]
    for slot in unavailable_slots:
        for day_str in slot.get('dayOfWeek',[]):
            day_of_week_int = int(day_str)
            for day_offset in range(DAYS_IN_WEEK):
                if (today_weekday+day_offset)%7==day_of_week_int:
                    s_h,s_m=map(int,slot['startTime'].split(':'));e_h,e_m=map(int,slot['endTime'].split(':'))
                    s_slot=day_offset*48+s_h*2+s_m//30; e_slot=day_offset*48+e_h*2+e_m//30
                    for s in range(s_slot,e_slot): ng_zones.add(s)
    return tasks_list,list(ng_zones)

# --- 5. 実行ロジック ---
def suggest_best_slot(target_task, ng_zones, ai_model):
    """単一タスクに最適な時間枠を高速に提案する"""
    best_slot, max_reward = -1, -float('inf')
    duration = target_task.required_slots
    start_of_week = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    
    for slot in range(TOTAL_SLOTS):
        if slot + duration > TOTAL_SLOTS: break
        
        slot_time = start_of_week + timedelta(minutes=30 * slot)
        if slot_time < datetime.now(): continue # 過去の時間はスキップ
        if target_task.deadline < slot_time: continue # タスクの期限を過ぎていたらスキップ

        is_placeable=all(slot+j not in ng_zones for j in range(duration))
        if is_placeable:
            reward=sum(ai_model.concentration_map[s] for s in range(slot, slot+duration))
            if target_task.rescheduled: reward += RESCHEDULE_REWARD_BONUS
            if reward > max_reward: max_reward, best_slot = reward, slot
            
    if best_slot != -1:
        start_time=start_of_week+timedelta(minutes=30*best_slot)
        end_time=start_time+timedelta(minutes=30*duration)
        return {"taskId":target_task.id, "title":target_task.name, "start":start_time.isoformat(), "end":end_time.isoformat()}
    else:
        return None

def run_background_learning(all_tasks, ng_zones, saved_model_data=None):
    """サーバー側で定期的に実行される、AIモデルの継続的な学習"""
    ai_model=AIModel(saved_model_data); ai_model.set_num_actions(len(all_tasks)+1)
    start_time=datetime.now().replace(hour=0,minute=0,second=0,microsecond=0)
    env=SchedulerEnv(all_tasks, ng_zones, start_time, ai_model.concentration_map)
    agent=QLearningAgent(ai_model)
    for _ in range(NUM_BACKGROUND_EPISODES):
        state=env.reset(); done=False
        while not done:
            p_a=env.get_possible_actions(state); action=agent.choose_action(state,p_a)
            n_s,r,done=env.step(action); n_p_a=env.get_possible_actions(n_s); agent.learn(state,action,r,n_s,n_p_a); state=n_s
    agent.decay_epsilon()
    return ai_model.to_json()
