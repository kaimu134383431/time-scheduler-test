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
    """ユーザーの学習モデル（集中度マップとQテーブル）を管理するクラス"""
    def __init__(self, model_data=None):
        # model_data は server.py から JSON として渡されるか、None となる
        if model_data and "concentration_map" in model_data:
            self.concentration_map = np.array(model_data['concentration_map'])
            # JSONのキーは文字列なので、Qテーブルを復元する際にキーを整数に変換
            self.q_table = defaultdict(lambda: np.zeros(model_data.get('num_actions', 0)), 
                                       {int(k): np.array(v) for k, v in model_data.get('q_table', {}).items()})
            self.num_actions = model_data.get('num_actions', 0)
        else:
            # 新規ユーザーの場合：モデルを新規作成
            self._initialize_new_model()

    def _initialize_new_model(self):
        """新規ユーザー用のモデルを初期値で作成"""
        self.concentration_map = np.ones(TOTAL_SLOTS) * 2.5  # 全て平均値
        self.num_actions = 0 # あとでタスク数に応じて設定（`set_num_actions`で設定される）
        self.q_table = defaultdict(lambda: np.zeros(0)) # 初期状態では行動数が0の配列を返す

    def set_num_actions(self, num_actions):
        """タスク数に応じてQテーブルのaction数を確定させる"""
        # num_actions が変更された場合のみQテーブルを再初期化
        if self.num_actions != num_actions:
            self.num_actions = num_actions
            new_q_table = defaultdict(lambda: np.zeros(self.num_actions))
            # 既存のQテーブルの値を新しいサイズにコピー（可能な範囲で）
            if hasattr(self, 'q_table'): # 初回初期化時以外
                for state, values in self.q_table.items():
                    new_values = np.zeros(self.num_actions)
                    min_len = min(len(values), len(new_values))
                    new_values[:min_len] = values[:min_len]
                    new_q_table[state] = new_values
            self.q_table = new_q_table

    def to_json(self):
        """外部（例: server.py）に保存するためにモデルをJSONシリアライズ可能な辞書に変換"""
        return {
            "concentration_map": self.concentration_map.tolist(),
            "q_table": {str(k): v.tolist() for k, v in self.q_table.items()}, # キーを文字列に変換
            "num_actions": self.num_actions
        }

    def apply_completion_feedback(self, completion_time_iso, rating):
        """完了報告モーダルの情報を元に集中度マップを更新する（Flaskの/feedbackから呼ばれる）"""
        completion_time = datetime.fromisoformat(completion_time_iso.replace('Z', '+00:00'))
        # どの曜日のどの時間かを計算（週の頭を月曜として計算）
        start_of_week = datetime.now() - timedelta(days=datetime.now().weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0) # 時刻を00:00:00にする
        
        # 完了時刻が週の頭から何秒経過したか
        delta_seconds = (completion_time - start_of_week).total_seconds()
        
        if delta_seconds >= 0: # 週の開始以降の時刻であれば処理
            slot_index = int(delta_seconds / 1800) # 30分 = 1800秒 でスロットインデックスを計算
            if 0 <= slot_index < TOTAL_SLOTS: # 有効なスロット範囲内であれば更新
                print(f"[フィードバック適用] スロット {slot_index} ({completion_time.strftime('%Y-%m-%d %H:%M')}) の評価を {rating} 点で更新。")
                # 集中度マップを更新: ALPHA（学習率）に応じてフィードバックを既存の値に反映
                self.concentration_map[slot_index] += ALPHA * (rating - self.concentration_map[slot_index])
        
    def apply_skip_feedback(self, start_slot, end_slot):
        """指定された時間帯の集中度マップにペナルティを適用する（将来的な日次学習などで使用）"""
        print(f"\n[フィードバック適用] スロット {start_slot}-{end_slot} の評価を下げます。")
        for i in range(start_slot, end_slot):
            if 0 <= i < len(self.concentration_map):
                self.concentration_map[i] += SKIP_PENALTY # スキップペナルティを適用

# --- 3. AIコアロジック（環境とエージェント） ---
class Task:
    """タスク情報を保持するクラス"""
    def __init__(self, id, name, required_slots, deadline_str, rescheduled=False):
        self.id = id # Reactのtask.idを保持
        self.name = name
        self.required_slots = required_slots # 必要な30分スロット数
        self.remaining_slots = required_slots # 残りのスロット数
        self.rescheduled = rescheduled # 再スケジュールされたタスクかどうかのフラグ

        if deadline_str:
            try:
                # ISOフォーマット（'YYYY-MM-DDTHH:MM:SSZ'）を優先
                self.deadline = datetime.fromisoformat(deadline_str.replace('Z', '+00:00'))
            except ValueError:
                # 'YYYY-MM-DD' の形式の場合、その日の終わりを期限とする
                self.deadline = datetime.strptime(deadline_str, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        else:
            # 期限が設定されていない場合はデフォルトで30日後
            self.deadline = datetime.now() + timedelta(days=30)

    def __repr__(self):
        return f"Task(id={self.id}, name={self.name}, rescheduled={self.rescheduled}, remaining={self.remaining_slots})"

class SchedulerEnv:
    """スケジューリング環境を表すクラス（強化学習の'環境'）"""
    def __init__(self, tasks, ng_zones, start_time, concentration_map):
        self.tasks_master = tasks # 元のタスクリスト
        self.ng_zones = ng_zones # 不可避な時間帯（NGゾーン）
        self.start_time = start_time # スケジュール開始時刻（通常は週の頭）
        self.concentration_map = concentration_map # 外部から受け取る集中度マップ
        # シミュレーション用の隠れた真の集中度マップ（学習のシミュレーション用）
        self.true_concentration_map = self._create_true_concentration_map() 
        self.reset()

    def reset(self):
        """環境を初期状態にリセットする"""
        # タスクリストをコピーして、残りのスロット数をリセット
        self.tasks = [Task(t.id, t.name, t.required_slots, t.deadline.strftime("%Y-%m-%d %H:%M:%S"), t.rescheduled) for t in self.tasks_master]
        self.schedule = ["-" for _ in range(TOTAL_SLOTS)] # スケジュールを空にする
        self.current_slot = 0 # 現在のスロットをリセット
        self.done = False # エピソード終了フラグ
        return self.current_slot # 初期状態（現在のスロット）を返す

    def _create_true_concentration_map(self):
        """ユーザーの隠れた集中度傾向を定義する（シミュレーション用）"""
        cmap = np.ones(TOTAL_SLOTS) * 2.0 # 全て2.0で初期化
        for day in range(DAYS_IN_WEEK):
            offset = day * SLOTS_PER_DAY # その日の開始スロット
            # 特定の時間帯に集中度が高い/低い傾向を設定
            cmap[offset + 18 : offset + 24] = 5.0 # 午前 (9:00-12:00) は高集中
            cmap[offset + 26 : offset + 34] = 1.0 # 午後 (13:00-17:00) は低集中
            cmap[offset + 44 : offset + 48] = 4.0 # 深夜 (22:00-24:00) に強い
        return cmap

    def get_possible_actions(self, current_slot):
        """現在のスロットから可能な行動（タスク配置または何もしない）を返す"""
        possible_actions = []
        for i, task in enumerate(self.tasks):
            if task.remaining_slots > 0: # 残りスロットがあるタスクのみ
                duration = task.remaining_slots
                # 現在のスロットからタスクを配置できるか、NGゾーンや既にスケジュール済みでないかチェック
                if current_slot + duration <= TOTAL_SLOTS and \
                   all(current_slot + j not in self.ng_zones and self.schedule[current_slot + j] == "-" for j in range(duration)):
                    possible_actions.append(i) # タスクのインデックスを可能な行動として追加
        possible_actions.append(len(self.tasks)) # 何もしない行動 (タスクリストの長さがインデックス)
        return possible_actions

    def step(self, action_idx):
        """選択された行動（タスクブロックの配置 or 何もしない）を実行する"""
        reward = 0
        t_len = len(self.tasks) # タスクの総数

        if action_idx == t_len: # 何もしない行動を選択した場合
            reward = -0.1 # 小さなペナルティ
            self.current_slot += 1 # 1スロット進む
        else: # 特定のタスクを配置する行動を選択した場合
            task = self.tasks[action_idx]
            duration = task.remaining_slots
            block_slots = range(self.current_slot, self.current_slot + duration)
            
            # 集中度マップに基づく報酬の計算
            reward = sum(self.concentration_map[s] for s in block_slots)

            # 締め切りが近いタスクへのボーナス
            if (task.deadline - (self.start_time + timedelta(minutes=30 * self.current_slot))).days < 2:
                reward += 10.0
            # 再スケジュールされたタスクへの報酬ボーナス
            if task.rescheduled:
                reward += RESCHEDULE_REWARD_BONUS
            
            # スケジュールにタスクを配置
            for i in range(duration):
                self.schedule[self.current_slot + i] = task.id
            task.remaining_slots = 0 # タスク完了
            self.current_slot += duration # スロットを進める

        # エピソード終了条件のチェック
        all_tasks_done = all(t.remaining_slots <= 0 for t in self.tasks) # 全タスク完了したか
        self.done = all_tasks_done or self.current_slot >= TOTAL_SLOTS # 全タスク完了または全スロット終了

        if self.done and not all_tasks_done:
            reward -= sum(t.remaining_slots for t in self.tasks) * 10.0 # 未完了タスクへの大きなペナルティ
        
        return self.current_slot, reward, self.done

class QLearningAgent:
    """Q学習エージェントクラス（強化学習の'エージェント'）"""
    def __init__(self, ai_model):
        self.model = ai_model # AIModelオブジェクトを保持 (Qテーブルと集中度マップを共有)
        self.epsilon = EPSILON_START # 探索率

    def choose_action(self, state, possible_actions):
        """行動を選択する (探索と活用のトレードオフ)"""
        # 可能な行動が「何もしない」のみの場合、それを選ぶ
        if len(possible_actions) <= 1: # 何もしない行動のみの場合 (possible_actionsには最低1つ含まれる)
            return self.model.num_actions - 1 # 何もしない行動のインデックス
        
        if random.uniform(0, 1) < self.epsilon:
            return random.choice(possible_actions) # 探索: ランダムに行動を選択
        else:
            # 活用: Qテーブルに基づいて最適な行動を選択
            q_values = self.model.q_table[state]
            # 可能な行動の中からQ値が最大のものを選択
            max_q = max(q_values[a] for a in possible_actions)
            # 最大Q値を持つ行動が複数ある場合はランダムに一つ選択
            best_actions = [a for a in possible_actions if q_values[a] == max_q]
            return random.choice(best_actions)

    def learn(self, state, action, reward, next_state, next_possible_actions):
        """Qテーブルを更新する（学習）"""
        old_value = self.model.q_table[state][action] # 現在のQ値
        
        # 次の状態での最大のQ値を計算
        # 次の可能な行動が「何もしない」のみの場合を考慮
        next_max_q = max(self.model.q_table[next_state][na] for na in next_possible_actions) \
                     if len(next_possible_actions) > 1 \
                     else self.model.q_table[next_state][self.model.num_actions - 1]
        
        # Q学習の更新式
        new_value = old_value + ALPHA * (reward + GAMMA * next_max_q - old_value)
        self.model.q_table[state][action] = new_value

    def decay_epsilon(self):
        """探索率epsilonを減衰させる"""
        if self.epsilon > EPSILON_MIN:
            self.epsilon *= EPSILON_DECAY


# --- 4. データ変換層 ---
def prepare_inputs_from_react(react_tasks, unavailable_slots=[], sleep_hours=[(0,7)]):
    """
    Reactから受け取ったデータをPythonのAIが使える形式に変換する。
    FlaskのAPIから呼ばれることを想定。
    Args:
        react_tasks (list): Reactのtasksステートの配列（辞書形式）
        unavailable_slots (list): ユーザー定義の固定の予定リスト（辞書形式）
        sleep_hours (list of tuples): 睡眠時間帯のリスト
    Returns:
        tuple: (Taskオブジェクトのリスト, NGゾーンのインデックスリスト)
    """
    tasks_list = []
    for task in react_tasks:
        # 完了済み、非表示のタスクは除外（AI提案や学習の対象外）
        if not task.get('completed', False) and not task.get('hidden', False) and task.get('estimatedTime', 0) > 0:
            tasks_list.append(
                Task(id=task['id'], name=task['title'],
                     required_slots=-(-task['estimatedTime'] // 30), # 分を30分スロットに変換（切り上げ）
                     deadline_str=task['deadline'],
                     rescheduled=task.get('rescheduled', False)) # 再スケジュールフラグを渡す
            )

    ng_zones = set() # 不可避な時間帯を格納するセット
    today = datetime.now().date()
    today_weekday = today.weekday() # Pythonの曜日 (月=0, ..., 日=6)

    # 睡眠時間をNGゾーンに追加
    for day_offset in range(DAYS_IN_WEEK): # 今週の7日間を対象
        for start_h, end_h in sleep_hours:
            for hour in range(start_h, end_h):
                for minute_slot in [0, 1]: # 30分スロット（0分と30分）
                    ng_zones.add(day_offset * SLOTS_PER_DAY + hour * 2 + minute_slot)

    # ユーザー定義の固定の予定をNGゾーンに追加
    for slot in unavailable_slots:
        for day_str in slot.get('dayOfWeek', []): # dayOfWeek は文字列の配列（例: ["1", "3", "5"]）
            day_of_week_int = int(day_str) # JSの曜日(0-6, Sun-Sat)からPythonの曜日へ

            for day_offset in range(DAYS_IN_WEEK):
                # 実行日の曜日を基準に、対象の曜日が今週の何日後かを計算
                # (today_weekday + day_offset) % 7 が現在処理している日付の曜日となる
                if (today_weekday + day_offset) % 7 == day_of_week_int:
                    start_h, start_m = map(int, slot['startTime'].split(':'))
                    end_h, end_m = map(int, slot['endTime'].split(':'))

                    start_slot = day_offset * SLOTS_PER_DAY + start_h * 2 + start_m // 30
                    end_slot = day_offset * SLOTS_PER_DAY + end_h * 2 + end_m // 30

                    # 終了時刻が含まれないようにするため、rangeの終点は-1しない
                    for s in range(start_slot, end_slot):
                        ng_zones.add(s)

    # Googleカレンダーの予定は、今回は `unavailable_slots` の引数からは直接受け取らないが
    # 必要に応じてここに追加するロジックを検討する。
    # (server.py の /suggest-slot エンドポイントのデータに googleEvents を含める必要がある)
    return tasks_list, list(ng_zones)


# --- 5. 実行ロジック ---
def suggest_best_slot(target_task, ng_zones, ai_model):
    """
    単一タスクに最適な時間枠を高速に提案する（Flaskの/suggest-slotから呼ばれる）
    この関数はモデルを学習させるのではなく、学習済みモデルを使って推論を行う。
    """
    best_slot, max_reward = -1, -float('inf')
    duration = target_task.required_slots # タスクに必要なスロット数
    # 今日の0時0分0秒から計算
    start_of_week = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) 
    
    for slot in range(TOTAL_SLOTS): # 全てのスロットを探索
        if slot + duration > TOTAL_SLOTS: # スロットの終わりを超過する場合はスキップ
            break
        
        slot_time = start_of_week + timedelta(minutes=30 * slot) # 現在のスロットの開始時刻
        if slot_time < datetime.now(): continue # 過去の時間はスキップ
        if target_task.deadline < slot_time: continue # タスクの期限を過ぎていたらスキップ

        # この時間枠にタスクを配置できるか（NGゾーンや他のタスクと重ならないか）チェック
        is_placeable=all(slot+j not in ng_zones for j in range(duration))
        if is_placeable:
            # 報酬を計算（集中度マップの値を合計）
            reward=sum(ai_model.concentration_map[s] for s in range(slot, slot+duration))
            # 再スケジュールされたタスクにはボーナス報酬を追加
            if target_task.rescheduled: reward += RESCHEDULE_REWARD_BONUS
            
            if reward > max_reward: # より良い報酬が見つかったら更新
                max_reward, best_slot = reward, slot
            
    if best_slot != -1: # 最適なスロットが見つかった場合
        start_time = start_of_week + timedelta(minutes=30 * best_slot)
        end_time = start_time + timedelta(minutes=30 * duration)
        # Reactに返す形式で結果を返す
        return {"taskId":target_task.id, "title":target_task.name, "start":start_time.isoformat(), "end":end_time.isoformat()}
    else:
        return None # 見つからなかった場合


def run_background_learning(all_tasks, ng_zones, saved_model_data=None):
    """
    サーバー側で定期的に実行される、AIモデルの継続的な学習（Flaskの定期実行で呼ばれることを想定）
    この関数は、モデルを学習・更新し、更新されたモデルデータを返す。
    """
    ai_model = AIModel(saved_model_data) # 既存モデルをロードまたは新規作成
    ai_model.set_num_actions(len(all_tasks) + 1) # 行動数を設定
    start_time = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    
    env = SchedulerEnv(all_tasks, ng_zones, start_time, ai_model.concentration_map)
    agent = QLearningAgent(ai_model)
    
    # 強化学習の学習エピソードを実行
    for _ in range(NUM_BACKGROUND_EPISODES):
        state = env.reset() # 環境をリセット
        done = False
        while not done:
            possible_actions = env.get_possible_actions(state) # 可能な行動を取得
            action = agent.choose_action(state, possible_actions) # エージェントが行動を選択
            next_state, reward, done = env.step(action) # 環境で行動を実行
            next_possible_actions = env.get_possible_actions(next_state)
            agent.learn(state, action, reward, next_state, next_possible_actions) # エージェントが学習
            state = next_state # 状態を更新
    
    agent.decay_epsilon() # 探索率を減衰
    
    return ai_model.to_json() # 更新されたモデルデータをJSON形式で返す
