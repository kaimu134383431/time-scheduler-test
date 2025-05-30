import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  query,
  // orderBy, // orderBy はインデックスの問題を避けるため、クライアントサイドでのソートを検討
  getDocs, // orderByの代わりにgetDocsで全件取得してソートする方針
} from "firebase/firestore";
import { GoogleOAuthProvider, useGoogleLogin } from "@react-oauth/google";
import axios from "axios";

// Tailwind CSS is assumed to be available in the environment.
// For icons, we'll use Lucide React icons.
import {
  Plus,
  Check,
  Clock,
  Calendar,
  Award,
  Flame,
  Smile,
  Frown,
  Meh,
  Mic,
  Lightbulb,
  ExternalLink,
  LogIn,
  User,
  Sparkles, // For AI suggestions
  ThumbsUp, // For positive feedback
  Brain, // For smart suggestions
  Zap, // For quick actions
  ChevronDown, // For collapsible sections
  ChevronUp,
  Edit3, // For editing tasks
  Trash2, // For deleting tasks (alternative to rotated Plus)
  RotateCcw, // For resetting or trying again
  MessageSquare, // For AI chat/feedback
  Settings2, // For settings
  Moon, // For "Do not disturb"
  Sun, // For "Active time"
} from "lucide-react";

// Firebaseの設定情報
// Canvas環境で__firebase_configが提供されない場合のフォールバック
const FIREBASE_CONFIG_PLACEHOLDER = {
  apiKey: "AIzaSyCfAwrP9o5v2YbN269xirD4zsLm5YIM1X4", // デモ用のキーです。実際のキーに置き換えてください。
  authDomain: "oceanic-student-460514-v8.firebaseapp.com",
  projectId: "oceanic-student-460514-v8",
  storageBucket: "oceanic-student-460514-v8.firebasestorage.app",
  messagingSenderId: "658537863941",
  appId: "1:658537863941:web:504f338368febd0e07356c",
};

const appId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";
const initialAuthToken =
  typeof __initial_auth_token !== "undefined"
    ? __initial_auth_token
    : undefined;

// Google OAuth Client ID (Provided by the user)
const GOOGLE_CLIENT_ID =
  "658537863941-7faa9ifaqso60b9kks1m6l4h4tgmt7up.apps.googleusercontent.com";

// AIによる励ましメッセージのバリエーションを増やします
const motivationalMessages = [
  "その調子です！！小さな一歩が大きな成果に繋がります！",
  "素晴らしい集中力ですね！このタスクが終わったら、少し休憩しましょう！",
  "よく頑張っていますね！あなたの努力はきっと実を結びます！",
  "もし行き詰まったら、深呼吸して、少し視点を変えてみましょう！",
  "あと少しで達成ですね！ゴールは目の前ですわー！",
  "一つ一つ着実に進めていて、本当にすごいです！",
  "困難な課題にも挑戦するあなたは、本当に立派です！",
  "焦らず、あなたのペースで進めていきましょう！",
];

const praiseForSmallWinMessages = [
  "やったねっ！小さな一歩でも、大きな成長だよ〜！すごいじゃん！",
  "さすがっ！この調子でどんどん進んじゃお〜！一緒にがんばろっ♪",
  "お見事っ！コツコツの積み重ねが、ちゃんと形になってきたね！",
  "完っ璧〜っ！やっぱり、君ならできるって信じてたよっ！",
];

function MainAppContent() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null); // userIdからcurrentUserIdに変更
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState(""); // 分単位
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [editingTask, setEditingTask] = useState(null); // 編集中のタスクを保持

  const [schedule, setSchedule] = useState([]);
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [badges, setBadges] = useState([]);
  const [avatarMood, setAvatarMood] = useState("neutral"); // 'happy', 'neutral', 'sad', 'focused'
  const [aiFeedback, setAiFeedback] = useState(
    "こんにちは！今日の目標は何にしましょうか～？"
  );
  const [message, setMessage] = useState({ text: "", type: "info" }); // type: 'info', 'success', 'error'

  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleUserInfo, setGoogleUserInfo] = useState(null);
  const [googleAccessToken, setGoogleAccessToken] = useState("");

  const [showTaskInput, setShowTaskInput] = useState(true); // タスク入力欄の表示/非表示
  const [showTaskList, setShowTaskList] = useState(true); // タスクリストの表示/非表示
  const [showSchedule, setShowSchedule] = useState(true); // スケジュール提案の表示/非表示
  const [showGamification, setShowGamification] = useState(true); // ゲーミフィケーションの表示/非表示

  const [isLoading, setIsLoading] = useState(false); // ローディング状態
  const [aiSuggestion, setAiSuggestion] = useState(""); // AIからのタスク分割提案など

  const taskInputRef = useRef(null);

  // --- Firebase 初期化と認証 ---
  useEffect(() => {
    try {
      const firebaseConfig =
        typeof window !== "undefined" &&
        window.__firebase_config &&
        Object.keys(JSON.parse(window.__firebase_config)).length > 0 // 空のオブジェクトでないことを確認
          ? JSON.parse(window.__firebase_config)
          : FIREBASE_CONFIG_PLACEHOLDER;

      if (
        !firebaseConfig.projectId ||
        firebaseConfig.projectId === "YOUR_PROJECT_ID"
      ) {
        console.error("Firebase configuration is missing or incomplete.");
        setMessage({
          text: "Firebase設定が不完全です。管理者にご連絡ください。",
          type: "error",
        });
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);
      // firebaseAuth.setLogLevel('debug'); // デバッグ用

      setDb(firestore);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setCurrentUserId(user.uid);
          console.log("Firebase Auth Ready. User ID:", user.uid);
          setIsAuthReady(true);
        } else {
          if (initialAuthToken) {
            try {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
              console.log("Signed in with custom token.");
            } catch (error) {
              console.error("Error signing in with custom token:", error);
              await signInAnonymously(firebaseAuth);
              console.log("Signed in anonymously due to custom token error.");
            }
          } else {
            await signInAnonymously(firebaseAuth);
            console.log("Signed in anonymously.");
          }
          // isAuthReady は onAuthStateChanged の初回呼び出し後に一度だけ true にする
          if (!isAuthReady && firebaseAuth.currentUser) {
            setCurrentUserId(firebaseAuth.currentUser.uid);
            setIsAuthReady(true);
            console.log(
              "Auth ready after anonymous/custom sign in. User ID:",
              firebaseAuth.currentUser.uid
            );
          } else if (!firebaseAuth.currentUser) {
            console.log(
              "User is not signed in yet after attempting anonymous/custom sign in."
            );
          }
        }
      });
      return () => unsubscribe();
    } catch (error) {
      console.error("Firebase initialization error:", error);
      setMessage({
        text: "Firebaseの初期化に失敗しました。ページを再読み込みしてみてください。",
        type: "error",
      });
    }
  }, []);

  // --- Firestore データリスナー (Tasks) ---
  useEffect(() => {
    if (!db || !currentUserId || !isAuthReady) return;

    const tasksCollectionPath = `artifacts/${appId}/users/${currentUserId}/tasks`;
    const tasksCollectionRef = collection(db, tasksCollectionPath);
    // FirestoreのorderByは複合インデックスが必要になる場合があり、PoCでは扱いが難しいため、
    // 全件取得後にクライアントサイドでソートする方針に変更します。
    // const q = query(tasksCollectionRef, orderBy("deadline", "asc"));
    const q = query(tasksCollectionRef);

    const unsubscribe = onSnapshot(
      q,
      async (querySnapshot) => {
        // querySnapshotに変更
        // const snapshot = await getDocs(q); // onSnapshot内でgetDocsは不要
        let fetchedTasks = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // クライアントサイドで期限順にソート
        fetchedTasks.sort((a, b) => {
          const dateA = a.deadline ? new Date(a.deadline) : new Date(0); // 未設定の場合は過去の日付
          const dateB = b.deadline ? new Date(b.deadline) : new Date(0);
          return dateA - dateB;
        });

        setTasks(fetchedTasks);
        updateAvatarAndFeedback(fetchedTasks);
        console.log("Tasks updated and sorted:", fetchedTasks);
      },
      (error) => {
        console.error("Error fetching tasks:", error);
        setMessage({
          text: "課題の取得中にエラーが発生しました。",
          type: "error",
        });
      }
    );
    return () => unsubscribe();
  }, [db, currentUserId, isAuthReady, appId]); // appIdを依存配列に追加

  // アバターのムードとAIフィードバックを更新する関数
  const updateAvatarAndFeedback = (currentTasks) => {
    const uncompletedTasks = currentTasks.filter((task) => !task.completed);
    const completedTasksCount = currentTasks.length - uncompletedTasks.length;

    if (currentTasks.length === 0) {
      setAvatarMood("neutral");
      setAiFeedback(
        "新しい目標を立ててみませんか～？わたくしがお手伝いします♪"
      );
    } else if (uncompletedTasks.length === 0) {
      setAvatarMood("happy");
      setAiFeedback(
        "全ての課題を完了しましたね！素晴らしいです！ゆっくりお休みください～"
      );
    } else if (completedTasksCount > 0) {
      setAvatarMood("focused");
      setAiFeedback(
        `順調に進んでいますね！あと${uncompletedTasks.length}件、この調子で頑張りましょう～！`
      );
    } else {
      setAvatarMood("sad");
      setAiFeedback(
        "少しお疲れのようですね…。まずは小さなことから始めてみませんか～？"
      );
    }
  };

  // --- Google Login ---
  const googleLogin = useGoogleLogin({
    scope:
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    onSuccess: async (tokenResponse) => {
      const token = tokenResponse.access_token;
      setGoogleAccessToken(token);
      setMessage({
        text: "Googleログイン成功です！カレンダー情報を取得しますね～",
        type: "success",
      });
      try {
        const userRes = await axios.get(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        setGoogleUserInfo(userRes.data);
        await fetchGoogleCalendarEvents(token);
      } catch (error) {
        console.error("Failed to fetch user info or calendar events:", error);
        setMessage({
          text: "Googleユーザー情報またはカレンダーの取得に失敗しましたわー。",
          type: "error",
        });
      }
    },
    onError: () =>
      setMessage({ text: "Googleログインに失敗しましたわー。", type: "error" }),
  });

  // --- Google Calendar イベント取得 ---
  const fetchGoogleCalendarEvents = async (token) => {
    if (!token) {
      setMessage({
        text: "Googleアクセストークンがありませんのー。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
      const res = await axios.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            timeMin: new Date().toISOString(),
            timeMax: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000
            ).toISOString(),
            singleEvents: true,
            orderBy: "startTime",
          },
        }
      );
      setGoogleEvents(res.data.items || []);
      setMessage({
        text: "Googleカレンダーの予定を取得しましたわー。",
        type: "info",
      });
    } catch (error) {
      console.error("Failed to fetch Google Calendar events:", error);
      setMessage({
        text: "Googleカレンダーの予定取得中にエラーが発生しました。",
        type: "error",
      });
      setGoogleEvents([]); // エラー時は空にする
    } finally {
      setIsLoading(false);
    }
  };

  // --- AIによるタスク分割提案 (モックに変更) ---
  const suggestSubTasks = async (mainTaskTitle) => {
    if (!mainTaskTitle.trim()) return;
    setAiSuggestion("AIが小タスクを考えています… (現在モック動作中です)");
    setIsLoading(true);

    // モックデータによる提案
    setTimeout(() => {
      const mockSubTasks = [
        `「${mainTaskTitle}」の資料集めをする`,
        `「${mainTaskTitle}」の構成を考える`,
        `「${mainTaskTitle}」の下書きを始める`,
        `「${mainTaskTitle}」の清書をする`,
        `「${mainTaskTitle}」を見直して提出する`,
      ];
      setAiSuggestion(
        `「${mainTaskTitle}」の小タスク案です：\n${mockSubTasks
          .map((st) => `- ${st}`)
          .join(
            "\n"
          )}\nこれらのタスクを個別に追加しますか～？ (この機能は現在開発中です)`
      );
      setIsLoading(false);
    }, 1500); // 1.5秒後に表示

    // 以下、Gemini API呼び出し部分はコメントアウト
    /*
      const apiKey = ""; // APIキーをここに設定 (本番では空のままにしてCanvas環境から供給)
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const prompt = `「${mainTaskTitle}」という課題を、実行しやすいように3～5個の具体的な小タスクに分割して、JSON配列の形式で提案してください。各小タスクは短い文字列にしてください。例: ["資料集め","構成案作成","下書き","清書","提出"]`;
      
      let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
      const payload = {
          contents: chatHistory,
          generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                  type: "ARRAY",
                  items: { type: "STRING" }
              }
          }
      };

      try {
          const response = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          if (!response.ok) {
              const errorData = await response.json();
              console.error('Gemini API error:', errorData);
              throw new Error(`API Error: ${response.status} ${errorData.error?.message || ''}`);
          }
          const result = await response.json();

          if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts[0].text) {
              const subTasksText = result.candidates[0].content.parts[0].text;
              const parsedSubTasks = JSON.parse(subTasksText); // JSON文字列をパース
              if (Array.isArray(parsedSubTasks) && parsedSubTasks.length > 0) {
                  setAiSuggestion(`「${mainTaskTitle}」の小タスク案ですわー：\n${parsedSubTasks.map(st => `- ${st}`).join('\n')}\nこれらのタスクを追加しますかー？`);
              } else {
                  setAiSuggestion("小タスクの提案がうまくできませんでしたわー。");
              }
          } else {
              setAiSuggestion("AIからの提案がありませんでしたのー。もう一度試してみますかー？");
          }
      } catch (error) {
          console.error('Error calling Gemini API for subtasks:', error);
          setAiSuggestion("タスク分割の提案中にエラーが起きましたわー。手動で入力してくださいましー。");
      } finally {
          setIsLoading(false);
      }
      */
  };

  // --- タスク追加/編集 ---
  const handleTaskSubmit = async () => {
    if (!db || !currentUserId || !isAuthReady) {
      setMessage({
        text: "システム準備中です。しばらくお待ちください～。",
        type: "error",
      });
      return;
    }
    if (!newTaskTitle.trim()) {
      setMessage({
        text: "課題タイトルを入力してください。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
      const tasksCollectionRef = collection(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`
      );
      const taskData = {
        title: newTaskTitle,
        estimatedTime: newTaskEstimate ? parseInt(newTaskEstimate) : 0,
        deadline: newTaskDeadline || null,
        completed: false,
        createdAt: new Date().toISOString(),
      };

      if (editingTask) {
        const taskDocRef = doc(
          db,
          `artifacts/${appId}/users/${currentUserId}/tasks`,
          editingTask.id
        );
        await updateDoc(taskDocRef, taskData);
        setMessage({
          text: `「${newTaskTitle}」を更新しました！`,
          type: "success",
        });
      } else {
        await addDoc(tasksCollectionRef, taskData);
        setMessage({
          text: `「${newTaskTitle}」を追加しました！`,
          type: "success",
        });
        if (newTaskEstimate && parseInt(newTaskEstimate) >= 60) {
          suggestSubTasks(newTaskTitle); // モックのタスク分割提案を呼び出し
        }
      }
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskDeadline("");
      setEditingTask(null);
      if (taskInputRef.current) taskInputRef.current.focus();
    } catch (error) {
      console.error("Error saving task:", error);
      setMessage({
        text: "課題の保存中にエラーが発生しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // タスク編集モード開始
  const startEditTask = (task) => {
    setEditingTask(task);
    setNewTaskTitle(task.title);
    setNewTaskEstimate(task.estimatedTime?.toString() || "");
    setNewTaskDeadline(task.deadline || "");
    setShowTaskInput(true);
    if (taskInputRef.current) taskInputRef.current.focus();
    setMessage({ text: `「${task.title}」を編集中です。`, type: "info" });
  };

  // --- タスク完了/未完了切り替え ---
  const toggleTaskCompletion = async (taskId, currentStatus) => {
    if (!db || !currentUserId || !isAuthReady) return;
    setIsLoading(true);
    try {
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      await updateDoc(taskDocRef, { completed: !currentStatus });

      const task = tasks.find((t) => t.id === taskId);
      const taskTitle = task ? task.title : "課題";

      if (!currentStatus) {
        setPoints(
          (prev) =>
            prev +
            (task?.estimatedTime
              ? Math.max(10, Math.floor(task.estimatedTime / 10))
              : 10)
        );
        setAiFeedback(
          `${taskTitle}を完了しましたね！${
            praiseForSmallWinMessages[
              Math.floor(Math.random() * praiseForSmallWinMessages.length)
            ]
          }`
        );
        setAvatarMood("happy");

        const today = new Date().toISOString().split("T")[0];
        const lastCompletion = JSON.parse(
          localStorage.getItem(`lastCompletion_${currentUserId}`)
        ) || { date: "", streak: 0 };
        if (lastCompletion.date !== today) {
          const newStreak =
            lastCompletion.date ===
            new Date(Date.now() - 86400000).toISOString().split("T")[0]
              ? lastCompletion.streak + 1
              : 1;
          setStreak(newStreak);
          localStorage.setItem(
            `lastCompletion_${currentUserId}`,
            JSON.stringify({ date: today, streak: newStreak })
          );
          if (newStreak > 1)
            setMessage({
              text: `${newStreak}日連続達成！素晴らしいです！`,
              type: "success",
            });
        }
      } else {
        setPoints((prev) => Math.max(0, prev - 10));
        setAiFeedback(`${taskTitle}を未完了に戻しました。もう一度挑戦です！`);
        setAvatarMood("neutral");
      }
      checkBadges();
    } catch (error) {
      console.error("Error toggling task completion:", error);
      setMessage({
        text: "課題の更新中にエラーが発生しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // --- タスク削除 ---
  const deleteTask = async (taskId) => {
    if (!db || !currentUserId || !isAuthReady) return;
    setIsLoading(true);
    try {
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      await deleteDoc(taskDocRef);
      setMessage({ text: "課題を削除しました。", type: "info" });
    } catch (error) {
      console.error("Error deleting task:", error);
      setMessage({
        text: "課題の削除中にエラーが発生しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // --- バッジ確認ロジック ---
  const checkBadges = () => {
    const newBadges = [...badges];
    if (points >= 50 && !newBadges.includes("努力家バッジ"))
      newBadges.push("努力家バッジ");
    if (points >= 100 && !newBadges.includes("達人バッジ"))
      newBadges.push("達人バッジ");
    if (streak >= 3 && !newBadges.includes("三日坊主卒業バッジ"))
      newBadges.push("三日坊主卒業バッジ");
    if (streak >= 7 && !newBadges.includes("継続の天才バッジ"))
      newBadges.push("継続の天才バッジ");
    if (
      tasks.filter((t) => t.completed).length >= 10 &&
      !newBadges.includes("タスクキラーバッジ")
    )
      newBadges.push("タスクキラーバッジ");

    if (newBadges.length > badges.length) {
      setBadges(newBadges);
      setMessage({
        text: `新しいバッジ「${
          newBadges[newBadges.length - 1]
        }」を獲得しました！おめでとうございます～！`,
        type: "success",
      });
    }
  };
  // 初期ロード時にlocalStorageからポイントなどを復元
  useEffect(() => {
    if (!currentUserId || !isAuthReady) return;
    const storedPoints = localStorage.getItem(`points_${currentUserId}`);
    if (storedPoints) setPoints(parseInt(storedPoints));

    const storedStreakData = JSON.parse(
      localStorage.getItem(`lastCompletion_${currentUserId}`)
    );
    if (storedStreakData) {
      const today = new Date().toISOString().split("T")[0];
      if (
        storedStreakData.date !== today &&
        storedStreakData.date !==
          new Date(Date.now() - 86400000).toISOString().split("T")[0]
      ) {
        setStreak(0);
        localStorage.setItem(
          `lastCompletion_${currentUserId}`,
          JSON.stringify({ date: "", streak: 0 })
        );
      } else {
        setStreak(storedStreakData.streak);
      }
    }
    const storedBadges = localStorage.getItem(`badges_${currentUserId}`);
    if (storedBadges) setBadges(JSON.parse(storedBadges));
  }, [currentUserId, isAuthReady]);

  // ポイント、ストリーク、バッジが変更されたらlocalStorageに保存
  useEffect(() => {
    if (!currentUserId || !isAuthReady) return;
    localStorage.setItem(`points_${currentUserId}`, points.toString());
  }, [points, currentUserId, isAuthReady]);
  useEffect(() => {
    if (!currentUserId || !isAuthReady) return;
    localStorage.setItem(`badges_${currentUserId}`, JSON.stringify(badges));
  }, [badges, currentUserId, isAuthReady]);

  // --- スケジュール提案ロジック (Google Calendar連携) ---
  const findAvailableTimeSlot = (
    existingEvents,
    durationMinutes,
    taskDeadlineStr
  ) => {
    const now = new Date();
    const taskDeadline = taskDeadlineStr
      ? new Date(taskDeadlineStr)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (taskDeadline < now) return null;

    const slotMs = durationMinutes * 60 * 1000;
    let searchStart = new Date(
      Math.max(now.getTime(), new Date(now).setHours(7, 0, 0, 0))
    );

    const sortedEvents = [...existingEvents]
      .map((e) => ({
        start: new Date(e.start?.dateTime || e.start?.date || 0),
        end: new Date(e.end?.dateTime || e.end?.date || 0),
      }))
      .filter((e) => e.start && e.end && e.end > now)
      .sort((a, b) => a.start - b.start);

    if (
      sortedEvents.length > 0 &&
      sortedEvents[0].start.getTime() - searchStart.getTime() >= slotMs
    ) {
      const potentialEnd = new Date(searchStart.getTime() + slotMs);
      if (potentialEnd <= taskDeadline)
        return { start: searchStart, end: potentialEnd };
    } else if (sortedEvents.length === 0) {
      const potentialEnd = new Date(searchStart.getTime() + slotMs);
      if (potentialEnd <= taskDeadline)
        return { start: searchStart, end: potentialEnd };
    }

    for (let i = 0; i < sortedEvents.length; i++) {
      const prevEventEnd = i === 0 ? searchStart : sortedEvents[i - 1].end;
      const currentEventStart = sortedEvents[i].start;

      let potentialStart = new Date(
        Math.max(prevEventEnd.getTime(), searchStart.getTime())
      );
      if (potentialStart.getHours() < 7) potentialStart.setHours(7, 0, 0, 0);
      if (potentialStart.getHours() >= 22) {
        potentialStart.setDate(potentialStart.getDate() + 1);
        potentialStart.setHours(7, 0, 0, 0);
      }

      if (currentEventStart.getTime() - potentialStart.getTime() >= slotMs) {
        const potentialEnd = new Date(potentialStart.getTime() + slotMs);
        if (potentialEnd <= taskDeadline)
          return { start: potentialStart, end: potentialEnd };
      }
    }

    if (sortedEvents.length > 0) {
      let lastEventEnd = sortedEvents[sortedEvents.length - 1].end;
      if (lastEventEnd.getHours() < 7) lastEventEnd.setHours(7, 0, 0, 0);
      if (lastEventEnd.getHours() >= 22) {
        lastEventEnd.setDate(lastEventEnd.getDate() + 1);
        lastEventEnd.setHours(7, 0, 0, 0);
      }
      const potentialEnd = new Date(lastEventEnd.getTime() + slotMs);
      if (potentialEnd <= taskDeadline)
        return { start: lastEventEnd, end: potentialEnd };
    }

    return null;
  };

  const suggestSchedule = async () => {
    if (!googleAccessToken) {
      setMessage({
        text: "Googleカレンダー連携のためにログインしてください。",
        type: "info",
      });
      googleLogin();
      return;
    }
    if (isLoading) return;
    setIsLoading(true);
    await fetchGoogleCalendarEvents(googleAccessToken);

    const uncompletedTasks = tasks.filter(
      (task) => !task.completed && task.estimatedTime > 0
    );
    if (uncompletedTasks.length === 0) {
      setSchedule([]);
      setMessage({
        text: "全ての課題が完了しているか、見積もり時間がないためスケジュール提案できません。",
        type: "info",
      });
      setIsLoading(false);
      return;
    }

    uncompletedTasks.sort((a, b) => {
      const deadlineA = a.deadline
        ? new Date(a.deadline)
        : new Date(8640000000000000);
      const deadlineB = b.deadline
        ? new Date(b.deadline)
        : new Date(8640000000000000);
      if (deadlineA - deadlineB !== 0) return deadlineA - deadlineB;
      return (a.estimatedTime || Infinity) - (b.estimatedTime || Infinity);
    });

    const suggestedSlots = [];
    let tempEvents = [...googleEvents];

    for (const task of uncompletedTasks) {
      const slot = findAvailableTimeSlot(
        tempEvents,
        parseInt(task.estimatedTime),
        task.deadline
      );
      if (slot) {
        const newScheduledItem = {
          title: task.title,
          taskId: task.id,
          startTime: slot.start.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          endTime: slot.end.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          startDate: slot.start.toLocaleDateString(),
          start: slot.start,
          end: slot.end,
        };
        suggestedSlots.push(newScheduledItem);
        tempEvents.push({
          start: { dateTime: slot.start.toISOString() },
          end: { dateTime: slot.end.toISOString() },
        });
        tempEvents.sort(
          (a, b) =>
            new Date(a.start.dateTime || a.start.date) -
            new Date(b.start.dateTime || b.start.date)
        );
      } else {
        console.warn(`課題「${task.title}」の空き時間が見つかりませんでした。`);
      }
    }
    setSchedule(suggestedSlots);
    if (suggestedSlots.length > 0) {
      setMessage({
        text: "AIがスケジュールを提案しました！",
        type: "success",
      });
    } else {
      setMessage({
        text: "現在、提案できる空き時間が見つかりませんでした。カレンダーを確認するか、タスクの期限や時間を見直してみてください。",
        type: "info",
      });
    }
    setIsLoading(false);
  };

  // --- AIによる励まし (モックに変更) ---
  const getAiMotivation = async () => {
    setAiFeedback("AIが励ましの言葉を考えています… ");
    setAvatarMood("focused");
    setIsLoading(true);

    // モックの励ましメッセージ
    setTimeout(() => {
      const uncompletedTasksTitles =
        tasks
          .filter((t) => !t.completed)
          .map((t) => t.title)
          .join(", ") || "たくさんの課題";
      let message =
        motivationalMessages[
          Math.floor(Math.random() * motivationalMessages.length)
        ];
      if (uncompletedTasksTitles !== "たくさんの課題") {
        message = `「${uncompletedTasksTitles}」の攻略、応援しております！ ${message}`;
      }
      setAiFeedback(message);
      setAvatarMood("happy");
      setIsLoading(false);
    }, 1000); // 1秒後に表示

    // 以下、Gemini API呼び出し部分はコメントアウト
    /*
    const uncompletedTasksTitles = tasks.filter(t => !t.completed).map(t => t.title).join(', ') || "たくさんの課題";
    const prompt = `私はやる気が出ない大学生です。現在「${uncompletedTasksTitles}」といった課題を抱えています。私を励まし、やる気を引き出すような、優しく前向きなメッセージを1つ生成してください。依田芳乃のような、古風で丁寧な言葉遣いでお願いします。`;
    
    const apiKey = ""; // APIキー
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
         if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${response.status} ${errorData.error?.message || ''}`);
        }
        const result = await response.json();
        if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0].text) {
            setAiFeedback(result.candidates[0].content.parts[0].text);
            setAvatarMood("happy");
        } else {
            setAiFeedback(motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)]); 
            setAvatarMood("neutral");
        }
    } catch (error) {
        console.error('Error calling Gemini API for motivation:', error);
        setAiFeedback(motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)]); 
        setAvatarMood("sad");
    } finally {
        setIsLoading(false);
    }
    */
  };

  // --- 音声入力 (モック) ---
  const mockVoiceInput = () => {
    setMessage({
      text: "音声入力は現在準備中です。例えば「レポートを明日までに30分やる」のように話しかけてください。",
      type: "info",
    });
  };

  // --- スケジュールをGoogleカレンダーに追加 ---
  const addScheduleToGoogleCalendar = async () => {
    if (schedule.length === 0) {
      setMessage({
        text: "カレンダーに追加するスケジュールがありません。",
        type: "info",
      });
      return;
    }
    if (!googleAccessToken) {
      setMessage({
        text: "Googleカレンダーへのアクセス許可が必要です。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const item of schedule) {
      const event = {
        summary: `【やる気アシスト】${item.title}`,
        description: `この時間は「${item.title}」に集中しましょう～！\n(やる気アシストAIより)`,
        start: {
          dateTime: item.start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: item.end.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      };
      try {
        await axios.post(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          event,
          {
            headers: {
              Authorization: `Bearer ${googleAccessToken}`,
              "Content-Type": "application/json",
            },
          }
        );
        successCount++;
      } catch (error) {
        console.error(
          "Error adding event to Google Calendar:",
          error.response ? error.response.data : error.message
        );
        failCount++;
      }
    }
    setMessage({
      text: `${successCount}件の課題をGoogleカレンダーに追加しましたわー！${
        failCount > 0 ? ` (${failCount}件は失敗...)` : ""
      }`,
      type: successCount > 0 ? "success" : "error",
    });
    setIsLoading(false);
    if (successCount > 0) setSchedule([]);
  };

  // --- UIレンダリング ---
  const renderAvatar = () => {
    let avatarSrc = "https://placehold.co/96x96/FFD54F/FFFFFF?text=😐"; // Neutral
    let animationClass = "";
    if (avatarMood === "happy") {
      avatarSrc = "https://placehold.co/96x96/81C784/FFFFFF?text=😊";
      animationClass = "animate-bounce-subtle";
    } else if (avatarMood === "sad") {
      avatarSrc = "https://placehold.co/96x96/EF9A9A/FFFFFF?text=😔";
      animationClass = "animate-shake";
    } else if (avatarMood === "focused") {
      avatarSrc = "https://placehold.co/96x96/64B5F6/FFFFFF?text=🧐"; // Focused
    }
    return (
      <img
        src={avatarSrc}
        alt="AI Avatar"
        className={`rounded-full w-20 h-20 md:w-24 md:h-24 object-cover shadow-lg ${animationClass}`}
        onError={(e) =>
          (e.target.src = "https://placehold.co/96x96/CCCCCC/FFFFFF?text=Error")
        }
      />
    );
  };

  const getTaskCardBgColor = (task) => {
    if (task.completed) return "bg-green-100 border-green-500";
    if (
      task.deadline &&
      new Date(task.deadline) < new Date() &&
      !task.completed
    )
      return "bg-red-100 border-red-500 animate-pulse-fast"; // 期限切れでアニメーション
    const deadlineDate = task.deadline ? new Date(task.deadline) : null;
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (deadlineDate && deadlineDate.toDateString() === today.toDateString())
      return "bg-yellow-100 border-yellow-500"; // 今日が期限
    if (deadlineDate && deadlineDate.toDateString() === tomorrow.toDateString())
      return "bg-orange-100 border-orange-500"; // 明日が期限
    return "bg-indigo-50 border-indigo-300";
  };

  // ローディングオーバーレイ
  // isLoadingがtrueの間だけ表示されるように修正
  if (isLoading && !db) {
    // dbがまだnull（初期化中）の場合のローディング
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-purple-100 to-indigo-200 flex flex-col items-center justify-center z-50">
        <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-white mb-6"></div>
        <p className="text-white text-2xl font-semibold">準備中です…</p>
        <p className="text-purple-200 text-lg mt-2">
          あなたのやる気を全力で応援します！
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-100 p-2 sm:p-4 font-inter text-gray-800">
      {isLoading && ( // db初期化後、他の処理中のローディング
        <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-500"></div>
          <p className="ml-4 text-white text-xl">処理中です…</p>
        </div>
      )}
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-2xl p-4 sm:p-6 md:p-8 space-y-6">
        <header className="text-center border-b-2 border-indigo-200 pb-4">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600 mb-1">
            やる気アシストAI
          </h1>
          <p className="text-md sm:text-lg text-gray-600">
            あなたの「やる気が出ない」を、わたくしが応援します！
          </p>
          {currentUserId && (
            <p className="text-xs text-gray-400 mt-1">
              ユーザーID: {currentUserId.substring(0, 8)}...
            </p>
          )}
          {message.text && (
            <div
              className={`mt-3 p-3 rounded-md text-sm shadow ${
                message.type === "success"
                  ? "bg-green-100 text-green-800"
                  : message.type === "error"
                  ? "bg-red-100 text-red-800"
                  : "bg-blue-100 text-blue-800"
              } animate-fade-in-down`}
            >
              {message.text}
            </div>
          )}
        </header>

        {!googleUserInfo && (
          <section className="bg-gray-50 rounded-lg p-4 shadow-md flex flex-col items-center">
            <button
              onClick={() => googleLogin()}
              className="flex items-center px-5 py-2.5 bg-white text-gray-700 rounded-full shadow-md hover:bg-gray-100 transition duration-300 transform hover:scale-105 border border-gray-300"
            >
              <img
                src="https://developers.google.com/identity/images/g-logo.png"
                alt="Google Logo"
                className="w-5 h-5 mr-2.5"
                onError={(e) => (e.target.style.display = "none")}
              />
              <LogIn className="mr-1.5 h-5 w-5 text-indigo-600" />{" "}
              Googleでカレンダー連携
            </button>
            <p className="text-xs text-gray-500 mt-2">
              カレンダーと連携して、より良いスケジュール提案をします。
            </p>
          </section>
        )}
        {googleUserInfo && (
          <div className="bg-green-50 p-3 rounded-lg shadow-sm text-center">
            <p className="text-sm text-green-700 font-medium">
              <User className="inline-block mr-2 h-5 w-5" />
              {googleUserInfo.name} さん、カレンダー連携済みです！
            </p>
          </div>
        )}

        <section className="bg-gradient-to-r from-purple-100 to-indigo-100 rounded-lg p-4 sm:p-6 shadow-lg flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-shrink-0">{renderAvatar()}</div>
          <div className="flex-grow text-center sm:text-left">
            <p className="text-lg sm:text-xl text-purple-800 font-semibold mb-2 leading-tight">
              <MessageSquare className="inline-block mr-2 h-6 w-6 align-text-bottom" />
              {aiFeedback}
            </p>
            <button
              onClick={getAiMotivation}
              disabled={isLoading}
              className="flex items-center justify-center px-5 py-2.5 bg-purple-600 text-white rounded-full shadow-md hover:bg-purple-700 transition duration-300 transform hover:scale-105 disabled:opacity-50"
            >
              <Sparkles className="mr-2 h-5 w-5" /> AIに励ましてもらう
            </button>
          </div>
        </section>

        {aiSuggestion && (
          <div
            className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 p-4 rounded-md shadow"
            role="alert"
          >
            <div className="flex">
              <div className="py-1">
                <Lightbulb className="h-6 w-6 text-yellow-500 mr-3" />
              </div>
              <div>
                <p className="font-bold">AIからの提案です～</p>
                <p className="text-sm whitespace-pre-line">{aiSuggestion}</p>
                <button
                  onClick={() => setAiSuggestion("")}
                  className="mt-2 text-xs text-yellow-600 hover:text-yellow-800"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        <CollapsibleSection
          title="そなたの頑張りメーター"
          icon={<Award className="h-6 w-6 text-yellow-500" />}
          isOpen={showGamification}
          setIsOpen={setShowGamification}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <GamificationCard
              icon={<Award className="h-7 w-7 text-blue-600" />}
              title="ポイント"
              value={points}
              color="blue"
            />
            <GamificationCard
              icon={<Flame className="h-7 w-7 text-red-600" />}
              title="ストリーク"
              value={`${streak} 日`}
              color="red"
            />
            <GamificationCard
              icon={<Check className="h-7 w-7 text-green-600" />}
              title="バッジ"
              value={badges.length > 0 ? badges.join(", ") : "まだなし"}
              color="green"
              isBadgeList={true}
              badges={badges}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title={editingTask ? "課題を編集" : "新しい課題を追加"}
          icon={
            editingTask ? (
              <Edit3 className="h-6 w-6 text-orange-500" />
            ) : (
              <Plus className="h-6 w-6 text-indigo-500" />
            )
          }
          isOpen={showTaskInput}
          setIsOpen={setShowTaskInput}
        >
          <div className="space-y-3">
            <div>
              <label
                htmlFor="taskTitle"
                className="block text-sm font-medium text-gray-700 mb-0.5"
              >
                課題タイトル <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="taskTitle"
                ref={taskInputRef}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                placeholder="例: レポートの下書き"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="taskEstimate"
                  className="block text-sm font-medium text-gray-700 mb-0.5"
                >
                  見積もり時間 (分)
                </label>
                <input
                  type="number"
                  id="taskEstimate"
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                  placeholder="例: 60"
                  value={newTaskEstimate}
                  onChange={(e) => setNewTaskEstimate(e.target.value)}
                  min="0"
                />
              </div>
              <div>
                <label
                  htmlFor="taskDeadline"
                  className="block text-sm font-medium text-gray-700 mb-0.5"
                >
                  期限
                </label>
                <input
                  type="date"
                  id="taskDeadline"
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                  value={newTaskDeadline}
                  onChange={(e) => setNewTaskDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <button
              onClick={handleTaskSubmit}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center px-5 py-2.5 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 transition duration-300 transform hover:scale-105 disabled:opacity-50"
            >
              {editingTask ? (
                <Edit3 className="mr-2 h-5 w-5" />
              ) : (
                <Plus className="mr-2 h-5 w-5" />
              )}{" "}
              {editingTask ? "課題を更新" : "課題を追加"}
            </button>
            {editingTask && (
              <button
                onClick={() => {
                  setEditingTask(null);
                  setNewTaskTitle("");
                  setNewTaskEstimate("");
                  setNewTaskDeadline("");
                  setMessage({ text: "", type: "info" });
                }}
                className="flex-1 sm:flex-none flex items-center justify-center px-5 py-2.5 bg-gray-200 text-gray-700 rounded-full shadow-md hover:bg-gray-300 transition duration-300"
              >
                <RotateCcw className="mr-2 h-5 w-5" /> キャンセル
              </button>
            )}
            <button
              onClick={mockVoiceInput}
              className="flex-1 sm:flex-none flex items-center justify-center px-5 py-2.5 bg-gray-200 text-gray-700 rounded-full shadow-md hover:bg-gray-300 transition duration-300"
            >
              <Mic className="mr-2 h-5 w-5" /> 音声入力 (準備中)
            </button>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="そなたの課題リスト"
          icon={<Zap className="h-6 w-6 text-green-500" />}
          isOpen={showTaskList}
          setIsOpen={setShowTaskList}
        >
          {tasks.length === 0 ? (
            <p className="text-gray-500 text-center py-4">
              まだ課題がありません。新しい課題を追加してみましょう！
            </p>
          ) : (
            <ul className="space-y-2.5">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={`p-3 rounded-lg shadow-sm border-l-4 transition-all duration-300 ease-in-out hover:shadow-md ${getTaskCardBgColor(
                    task
                  )}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3
                        className={`text-md font-semibold truncate ${
                          task.completed
                            ? "line-through text-gray-500"
                            : "text-gray-800"
                        }`}
                      >
                        {task.title}
                      </h3>
                      <div className="flex flex-wrap items-center text-xs text-gray-600 mt-0.5 gap-x-2 gap-y-0.5">
                        {task.estimatedTime > 0 && (
                          <span className="flex items-center">
                            <Clock className="h-3.5 w-3.5 mr-0.5 text-gray-500" />{" "}
                            {task.estimatedTime} 分
                          </span>
                        )}
                        {task.deadline && (
                          <span
                            className={`flex items-center ${
                              new Date(task.deadline) < new Date() &&
                              !task.completed
                                ? "text-red-600 font-bold"
                                : ""
                            }`}
                          >
                            <Calendar className="h-3.5 w-3.5 mr-0.5 text-gray-500" />{" "}
                            期限:{" "}
                            {new Date(task.deadline).toLocaleDateString(
                              "ja-JP"
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-1.5 ml-2">
                      <button
                        onClick={() =>
                          toggleTaskCompletion(task.id, task.completed)
                        }
                        className={`p-1.5 rounded-full transition duration-300 shadow-sm ${
                          task.completed
                            ? "bg-green-500 hover:bg-green-600"
                            : "bg-indigo-500 hover:bg-indigo-600"
                        } text-white`}
                        title={task.completed ? "未完了に戻す" : "完了にする"}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => startEditTask(task)}
                        className="p-1.5 rounded-full bg-yellow-400 hover:bg-yellow-500 text-white shadow-sm transition duration-300"
                        title="編集"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-1.5 rounded-full bg-red-400 hover:bg-red-500 text-white shadow-sm transition duration-300"
                        title="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="AIスケジュール提案"
          icon={<Brain className="h-6 w-6 text-teal-500" />}
          isOpen={showSchedule}
          setIsOpen={setShowSchedule}
        >
          <button
            onClick={suggestSchedule}
            disabled={isLoading || !googleAccessToken}
            className="w-full px-5 py-2.5 bg-teal-600 text-white rounded-full shadow-md hover:bg-teal-700 transition duration-300 transform hover:scale-105 mb-3 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Calendar className="mr-2 h-5 w-5" /> スケジュールを提案してもらう
          </button>
          {!googleAccessToken && (
            <p className="text-xs text-center text-gray-500 mb-2">
              Googleカレンダーと連携すると、空き時間を考慮した提案ができます。
            </p>
          )}
          {schedule.length === 0 && googleAccessToken && (
            <p className="text-gray-500 text-center py-3">
              提案できるスケジュールがありません。未完了の課題があるか、またはGoogleカレンダーの空き時間を確認してください。
            </p>
          )}
          {schedule.length > 0 && (
            <>
              <ul className="space-y-1.5 mb-3">
                {schedule.map((item, index) => (
                  <li
                    key={index}
                    className="bg-teal-50 p-2.5 rounded-md flex items-center justify-between shadow-sm"
                  >
                    <div>
                      <span className="font-medium text-teal-800 text-sm">
                        {item.title}
                      </span>
                      <span className="block text-xs text-teal-700">
                        {item.startDate}
                      </span>
                    </div>
                    <span className="text-xs text-teal-700 font-semibold">
                      {item.startTime} - {item.endTime}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={addScheduleToGoogleCalendar}
                disabled={isLoading}
                className="w-full px-5 py-2.5 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition duration-300 transform hover:scale-105 flex items-center justify-center disabled:opacity-50"
              >
                <ExternalLink className="mr-2 h-5 w-5" /> Googleカレンダーに追加
              </button>
            </>
          )}
        </CollapsibleSection>

        <footer className="text-center text-gray-500 text-xs pt-6 border-t border-gray-200">
          <p>&copy; 2024 やる気アシストAI. あなたの頑張りを応援します！</p>
        </footer>
      </div>

      <style>{`
        @keyframes bounce-subtle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .animate-bounce-subtle { animation: bounce-subtle 1.5s infinite ease-in-out; }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); } 20%, 40%, 60%, 80% { transform: translateX(3px); } }
        .animate-shake { animation: shake 0.4s ease-in-out; }
        @keyframes fade-in-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-down { animation: fade-in-down 0.4s ease-out forwards; }
        @keyframes pulse-fast { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }
        .animate-pulse-fast { animation: pulse-fast 1s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>
    </div>
  );
}

// Collapsible Section Component
const CollapsibleSection = ({ title, icon, children, isOpen, setIsOpen }) => {
  return (
    <section className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 sm:p-4 bg-gray-50 hover:bg-gray-100 transition duration-200 focus:outline-none"
      >
        <div className="flex items-center">
          {icon && <span className="mr-2 text-indigo-600">{icon}</span>}
          <h2 className="text-lg sm:text-xl font-bold text-gray-700">
            {title}
          </h2>
        </div>
        {isOpen ? (
          <ChevronUp className="h-6 w-6 text-gray-500" />
        ) : (
          <ChevronDown className="h-6 w-6 text-gray-500" />
        )}
      </button>
      {isOpen && (
        <div className="p-3 sm:p-4 border-t border-gray-200 animate-fade-in-down">
          {children}
        </div>
      )}
    </section>
  );
};

// Gamification Card Component
const GamificationCard = ({
  icon,
  title,
  value,
  color,
  isBadgeList,
  badges,
}) => {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    red: "bg-red-50 text-red-800 border-red-200",
    green: "bg-green-50 text-green-800 border-green-200",
    yellow: "bg-yellow-50 text-yellow-800 border-yellow-200",
  };
  return (
    <div
      className={`rounded-lg p-3 shadow-sm flex flex-col items-center border ${
        colorClasses[color] || colorClasses.blue
      }`}
    >
      {icon}
      <p className="text-md font-semibold mt-1">{title}</p>
      {isBadgeList ? (
        <div className="flex flex-wrap justify-center mt-1">
          {badges && badges.length > 0 ? (
            badges.map((badge, index) => (
              <span
                key={index}
                className={`bg-${color}-200 text-${color}-800 text-xs px-1.5 py-0.5 rounded-full m-0.5`}
              >
                {badge}
              </span>
            ))
          ) : (
            <span className="text-gray-500 text-sm">まだありません</span>
          )}
        </div>
      ) : (
        <p
          className={`text-2xl font-bold ${colorClasses[color].replace(
            "bg-",
            "text-"
          )}`}
        >
          {value}
        </p>
      )}
    </div>
  );
};

export default function App() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID") {
    return (
      <div
        style={{
          padding: "20px",
          textAlign: "center",
          fontFamily: "sans-serif",
          color: "#555",
        }}
      >
        <h1>AIやる気アシスタント (設定エラー)</h1>
        <p>Google OAuth Client IDが設定されていません。</p>
        <p>
          <code>App.js</code>内の<code>GOOGLE_CLIENT_ID</code>
          を正しい値に更新してください。
        </p>
        <p>この設定がないと、Googleカレンダー連携機能が使えません。</p>
      </div>
    );
  }
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <MainAppContent />
    </GoogleOAuthProvider>
  );
}
