import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "firebase/auth";

// Tailwind CSS is assumed to be available in the environment.
// For icons, we'll use Lucide React icons.
import {
  Plus,
  Check,
  Clock,
  Calendar,
  LogIn,
  User,
  Sparkles,
  Zap,
  ChevronDown,
  ChevronUp,
  Trash2,
  Star, // For ratings
  ThumbsUp,
  RefreshCw,
  XCircle,
  Rewind, // スキップアイコン用
  Sun, // 朝型アイコン
  Moon, // 夜型アイコン
  RotateCw, // リセットアイコン
} from "lucide-react";

// Firebase configuration placeholder - This setting will be overwritten by __firebase_config provided by the Canvas environment.
const FIREBASE_CONFIG_PLACEHOLDER = {
  apiKey: "AIzaSyCfAwrP9o5v2YbN269xirD4zsLm5YIM1X4", // Demo key. Please replace with your actual key.
  authDomain: "oceanic-student-460514-v8.firebaseapp.com",
  projectId: "oceanic-student-460514-v8",
  storageBucket: "oceanic-student-460514-v8.firebasestorage.app",
  messagingSenderId: "658537863941",
  appId: "1:658537863941:web:504f338368febd0e07356c",
};

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";
const initialAuthToken =
  typeof __initial_auth_token !== "undefined"
    ? __initial_auth_token
    : undefined;

// Google OAuth Client ID
const GOOGLE_CLIENT_ID =
  "658537863941-7faa9ifaqso60b9kks1m6l4h4tgmt7up.apps.googleusercontent.com";

// FlaskサーバーのURL
const FLASK_SERVER_URL = "https://2p9ty2-5001.csb.app/";

// --- Star Rating Component ---
const StarRating = ({ rating, setRating, readOnly = false }) => {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center">
      {[...Array(5)].map((star, index) => {
        const ratingValue = index + 1;
        return (
          <label key={index}>
            <input
              type="radio"
              name={`rating-${Math.random()}`}
              className="hidden"
              value={ratingValue}
              onClick={() => !readOnly && setRating(ratingValue)}
              readOnly={readOnly}
            />
            <Star
              className={`w-6 h-6 transition-colors ${
                readOnly ? "" : "cursor-pointer"
              } ${
                ratingValue <= (hover || rating)
                  ? "text-yellow-400 fill-yellow-400"
                  : "text-gray-300"
              }`}
              onMouseEnter={() => !readOnly && setHover(ratingValue)}
              onMouseLeave={() => !readOnly && setHover(0)}
            />
          </label>
        );
      })}
    </div>
  );
};

// --- Completion Feedback Modal Component ---
const CompletionFeedbackModal = ({ task, onClose, onSave, isLoading }) => {
  const [concentrationRating, setConcentrationRating] = useState(0);
  const [completionDateTime, setCompletionDateTime] = useState(() => {
    const now = new Date();
    const options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Tokyo",
    };
    const formatter = new Intl.DateTimeFormat("ja-JP", options);
    const parts = formatter.formatToParts(now);

    const year = parts.find((p) => p.type === "year").value;
    const month = parts.find((p) => p.type === "month").value;
    const day = parts.find((p) => p.type === "day").value;
    const hour = parts.find((p) => p.type === "hour").value;
    const minute = parts.find((p) => p.type === "minute").value;

    return `${year}-${month}-${day}T${hour}:${minute}`;
  });

  const handleSave = () => {
    onSave(task.id, concentrationRating, new Date(completionDateTime));
  };

  if (!task) return null;

  const isOverdue =
    task.end && new Date() > new Date(task.end) && !task.completed;

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-5 transform animate-fade-in-down">
        <h2 className="text-2xl font-bold text-center text-indigo-700">
          {isOverdue ? "課題の完了処理" : "課題完了おめでとうございます！"}
        </h2>
        <p className="text-center text-gray-600 text-lg">
          「<span className="font-semibold">{task.title}</span>」を完了します
          {isOverdue && (
            <span className="text-red-500 font-bold ml-2">(期限切れ)</span>
          )}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              今回の課題の集中度はどうでしたか？
            </label>
            <div className="flex justify-center">
              <StarRating
                rating={concentrationRating}
                setRating={setConcentrationRating}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="completionDateTime"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              完了時刻
            </label>
            <input
              type="datetime-local"
              id="completionDateTime"
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              value={completionDateTime}
              onChange={(e) => setCompletionDateTime(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center px-5 py-2.5 bg-green-600 text-white rounded-full shadow-md hover:bg-green-700 transition transform hover:scale-105 disabled:opacity-50"
          >
            <Check className="mr-2 h-5 w-5" /> 完了！集中度と時間を記録
          </button>
          <button
            onClick={onClose}
            className="sm:flex-none flex items-center justify-center px-5 py-2.5 bg-gray-300 text-gray-800 rounded-full shadow-md hover:bg-gray-400 transition"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};

function MainAppContent() {
  const [auth, setAuth] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [unavailableSlots, setUnavailableSlots] = useState([]);
  const authCheckCompletedRef = useRef(false);

  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");

  const [message, setMessage] = useState({ text: "", type: "info" });
  const [aiDateSuggestion, setAiDateSuggestion] = useState(null);

  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleUserInfo, setGoogleUserInfo] = useState(null);
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [googleTokenClient, setGoogleTokenClient] = useState(null);

  const [showTaskInput, setShowTaskInput] = useState(true);
  const [showTaskList, setShowTaskList] = useState(true);

  const [userPreference, setUserPreference] = useState(null);
  const [showUserPreference, setShowUserPreference] = useState(true);

  const [
    showCompletionFeedbackModalForTask,
    setShowCompletionFeedbackModalForTask,
  ] = useState(null);

  const [isLoading, setIsLoading] = useState(false);

  const taskInputRef = useRef(null);

  // --- Firebase Initialization and Auth ---
  useEffect(() => {
    try {
      const firebaseConfig =
        typeof window !== "undefined" &&
        window.__firebase_config &&
        Object.keys(JSON.parse(window.__firebase_config)).length > 0
          ? JSON.parse(window.__firebase_config)
          : FIREBASE_CONFIG_PLACEHOLDER;

      if (
        !firebaseConfig.projectId ||
        firebaseConfig.projectId === "YOUR_PROJECT_ID"
      ) {
        console.error("Firebase configuration is missing or incomplete.");
        setMessage({
          text: "Firebase設定が不完全です。管理者に問い合わせるか、Firebase設定を確認してください。",
          type: "error",
        });
        setIsAuthReady(true);
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firebaseAuth = getAuth(app);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (!authCheckCompletedRef.current) {
          authCheckCompletedRef.current = true;

          if (user) {
            setCurrentUserId(user.uid);
          } else {
            try {
              if (initialAuthToken) {
                await signInWithCustomToken(firebaseAuth, initialAuthToken);
              } else {
                await signInAnonymously(firebaseAuth);
              }
              if (firebaseAuth.currentUser) {
                setCurrentUserId(firebaseAuth.currentUser.uid);
              } else {
                setMessage({
                  text: "ユーザー認証に失敗しました。一部機能が利用できない場合があります。",
                  type: "error",
                });
              }
            } catch (error) {
              console.error("Error during initial authentication:", error);
              setMessage({
                text: "認証中にエラーが発生しました。匿名で続行します。",
                type: "error",
              });
              try {
                await signInAnonymously(firebaseAuth);
                if (firebaseAuth.currentUser) {
                  setCurrentUserId(firebaseAuth.currentUser.uid);
                }
              } catch (anonError) {
                console.error(
                  "Failed anonymous sign-in after error:",
                  anonError
                );
                setMessage({
                  text: "致命的な認証エラーが発生しました。アプリをロードできません。",
                  type: "error",
                });
              }
            }
          }
          setIsAuthReady(true);
        }
      });
      return () => unsubscribe();
    } catch (error) {
      console.error("Firebase initialization error:", error);
      setMessage({
        text: "Firebaseの初期化に失敗しました。ページをリロードしてください。",
        type: "error",
      });
      setIsAuthReady(true);
    }
  }, []);

  // --- Google GSI Client Initialization ---
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID") {
      setMessage({
        text: "Google OAuth Client IDが設定されていません。管理者に連絡してください。",
        type: "error",
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && window.google.accounts) {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope:
            "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.profile",
          callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
              setGoogleAccessToken(tokenResponse.access_token);
              handleGoogleLoginSuccess(tokenResponse.access_token);
            }
          },
        });
        setGoogleTokenClient(client);
      } else {
        console.error(
          "Google GSI script loaded, but window.google.accounts is not available."
        );
        setMessage({
          text: "Google認証ライブラリの読み込みに問題が発生しました。",
          type: "error",
        });
      }
    };
    script.onerror = () => {
      console.error("Failed to load Google GSI client script.");
      setMessage({
        text: "Google認証スクリプトの読み込みに失敗しました。",
        type: "error",
      });
    };
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // --- Fetch Tasks from Flask Backend ---
  const fetchTasks = async () => {
    if (!currentUserId || !googleUserInfo) {
      setTasks([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(
        `${FLASK_SERVER_URL}/tasks/${currentUserId}`
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "タスクリストの取得に失敗しました");
      }
      let fetchedTasks = await response.json();

      fetchedTasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const deadlineA = a.deadline
          ? new Date(a.deadline).getTime()
          : Infinity;
        const deadlineB = b.deadline
          ? new Date(b.deadline).getTime()
          : Infinity;
        if (deadlineA !== deadlineB) return deadlineA - deadlineB;
        const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return createdAtA - createdAtB;
      });

      setTasks(fetchedTasks.filter((task) => !task.hidden));
      setMessage({ text: "課題リストを更新しました。", type: "info" });
    } catch (error) {
      console.error("Error fetching tasks:", error);
      setMessage({
        text: `課題の取得中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUserId && googleUserInfo) {
      fetchTasks();
    } else {
      setTasks([]);
    }
  }, [currentUserId, googleUserInfo]);

  // --- Fetch User Preference from Flask Backend ---
  const fetchUserPreference = async () => {
    if (!currentUserId) {
      setUserPreference(null);
      return;
    }
    try {
      const response = await fetch(
        `${FLASK_SERVER_URL}/user-preference/${currentUserId}`
      );
      if (response.ok) {
        const data = await response.json();
        const pref = data.preferenceType; // 'morning', 'night', or 'neutral'
        // neutralや未設定は未完了とみなす
        if (pref && pref !== "neutral") {
          setUserPreference(pref);
          setShowUserPreference(false); // 設定済みならセクションを閉じる
        } else {
          setUserPreference(null);
          setShowUserPreference(true); // 未設定ならセクションを開く
        }
      } else {
        console.warn("User preference not found or error fetching.");
        setUserPreference(null);
        setShowUserPreference(true);
      }
    } catch (error) {
      console.error("Error fetching user preference:", error);
      setUserPreference(null);
      setShowUserPreference(true);
    }
  };

  useEffect(() => {
    if (!currentUserId) return;

    const fetchUnavailableSlots = async () => {
      try {
        const response = await fetch(
          `${FLASK_SERVER_URL}/unavailable-slots/${currentUserId}`
        );
        if (response.ok) {
          const data = await response.json();
          setUnavailableSlots(data || []);
        }
      } catch (error) {
        console.error("固定NGゾーンの取得に失敗:", error);
      }
    };

    fetchUnavailableSlots();
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      fetchUserPreference();
    }
  }, [currentUserId]);

  // --- Google Login & Calendar ---
  const handleGoogleLoginClick = () => {
    if (googleTokenClient) {
      googleTokenClient.requestAccessToken();
    } else {
      setMessage({ text: "Google認証の準備ができていません。", type: "error" });
    }
  };

  const handleGoogleLoginSuccess = async (token) => {
    setMessage({
      text: "Googleログイン成功！カレンダー情報を取得します。",
      type: "success",
    });
    try {
      const userRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!userRes.ok) throw new Error(`HTTP error! status: ${userRes.status}`);
      const userData = await userRes.json();
      setGoogleUserInfo(userData);
      await fetchGoogleCalendarEvents(token);
    } catch (error) {
      console.error(
        "Failed to fetch Google user info or calendar events:",
        error
      );
      setMessage({
        text: "Googleユーザー情報またはカレンダーの取得に失敗しました。",
        type: "error",
      });
    }
  };

  const fetchGoogleCalendarEvents = async (token) => {
    if (!token) return;
    setIsLoading(true);
    try {
      const timeMin = new Date().toISOString();
      const timeMax = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      const params = new URLSearchParams({
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: "startTime",
      }).toString();

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(
          `HTTP error! status: ${res.status}, Message: ${errorData.error.message}`
        );
      }
      const data = await res.json();
      setGoogleEvents(data.items || []);
      setMessage({
        text: "Googleカレンダーの予定を読み込みました。",
        type: "info",
      });
    } catch (error) {
      console.error("Failed to fetch Google Calendar events:", error);
      setMessage({
        text: "Googleカレンダーの予定取得中にエラーが発生しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addEventToGoogleCalendar = async (
    title,
    startTime,
    endTime,
    description = ""
  ) => {
    if (!googleAccessToken) {
      setMessage({
        text: "Googleカレンダー連携が有効ではありません。イベントを追加できません。",
        type: "warning",
      });
      return { success: false };
    }

    setIsLoading(true);
    try {
      const event = {
        summary: title,
        description: description,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: "Asia/Tokyo",
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: "Asia/Tokyo",
        },
      };

      const response = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        setMessage({
          text: `Googleカレンダーへの追加に失敗しました: ${errorData.error.message}`,
          type: "error",
        });
        return { success: false };
      }

      const data = await response.json();
      setMessage({
        text: `課題をGoogleカレンダーに追加しました: ${data.htmlLink}`,
        type: "success",
      });
      return { success: true, eventId: data.id };
    } catch (error) {
      setMessage({
        text: "Googleカレンダーへの追加中にエラーが発生しました。",
        type: "error",
      });
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  };

  const deleteEventFromGoogleCalendar = async (eventId) => {
    if (!googleAccessToken) {
      return false;
    }
    setIsLoading(true);
    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
          },
        }
      );
      if (!response.ok && response.status !== 204) {
        const errorData = await response.json();
        setMessage({
          text: `Googleカレンダーからの削除に失敗しました: ${errorData.error.message}`,
          type: "error",
        });
        return false;
      }
      setMessage({
        text: "Googleカレンダーからイベントを削除しました。",
        type: "info",
      });
      return true;
    } catch (error) {
      setMessage({
        text: "Googleカレンダーからの削除中にエラーが発生しました。",
        type: "error",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleRejectAndResuggest = async () => {
    // aiDateSuggestionが存在しない場合は、エラーを防ぐために処理を中断する
    if (!aiDateSuggestion) {
      console.error(
        "エラー: 再提案ボタンが、AIの提案がない状態で押されました。"
      );
      return;
    }

    // ユーザーIDや設定のチェックはそのまま
    if (!currentUserId || !userPreference) {
      setMessage({
        text: "再提案に必要な情報が不足しています。",
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    setMessage({
      text: "フィードバックを学習し、別の時間を探しています...",
      type: "info",
    });

    try {
      const rejectResponse = await fetch(
        `${FLASK_SERVER_URL}/reject-suggestion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUserId,
            // この時点では aiDateSuggestion は null ではないことが保証されている
            startTime: aiDateSuggestion.suggestedSlot.start.toISOString(),
          }),
        }
      );

      if (!rejectResponse.ok) {
        const errorData = await rejectResponse.json();
        throw new Error(errorData.error || "フィードバックの送信に失敗");
      }

      // 再提案を依頼。引数に「拒否したスロット」の情報を渡す
      await requestAiSuggestion(aiDateSuggestion.suggestedSlot);
    } catch (error) {
      setMessage({
        text: `再提案中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
      setIsLoading(false);
    }
  };

  const requestAiSuggestion = async (rejectedSlot = null) => {
    if (!googleUserInfo) {
      setMessage({
        text: "AI提案を利用するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!newTaskTitle.trim() || !newTaskEstimate.trim()) {
      setMessage({
        text: "課題タイトルと見積もり時間は必須です。",
        type: "error",
      });
      return;
    }
    if (!userPreference) {
      setMessage({
        text: "朝型/夜型の設定を選択してください。",
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    try {
      const existingPlacedTasks = tasks.filter((t) => t.start && !t.completed);
      const uncompletedAndUnscheduledTasks = tasks.filter(
        (t) => !t.completed && !t.start
      );

      const requestBody = {
        userId: currentUserId,
        task: {
          id: "temp-" + Date.now(),
          title: newTaskTitle,
          estimatedTime: parseInt(newTaskEstimate),
          deadline: newTaskDeadline || null,
        },
        existingTasks: existingPlacedTasks,
        uncompletedTasks: uncompletedAndUnscheduledTasks,
        unavailableSlots: unavailableSlots,
      };

      if (rejectedSlot) {
        requestBody.rejectedSlot = {
          start: rejectedSlot.start.toISOString(),
          end: rejectedSlot.end.toISOString(),
        };
      }

      console.log(
        "AIへのリクエスト内容:",
        JSON.stringify(requestBody, null, 2)
      );

      const response = await fetch(`${FLASK_SERVER_URL}/suggest-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "AI提案の取得に失敗しました");
      }

      const suggestion = await response.json();
      setAiDateSuggestion({
        title: newTaskTitle,
        estimatedTime: newTaskEstimate,
        suggestedSlot: {
          start: new Date(suggestion.start),
          end: new Date(suggestion.end),
        },
      });
      setMessage({ text: "AIが最適な日時を提案しました！", type: "info" });
    } catch (error) {
      setMessage({
        text: `AI提案中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
      setAiDateSuggestion(null);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmAndAddTask = async () => {
    if (!currentUserId || !aiDateSuggestion) return;
    setIsLoading(true);
    const { title, estimatedTime, suggestedSlot } = aiDateSuggestion;
    const finalDeadline = suggestedSlot.start.toISOString().split("T")[0];

    try {
      let googleEventId = null;
      if (googleAccessToken) {
        const addEventResult = await addEventToGoogleCalendar(
          title,
          suggestedSlot.start,
          suggestedSlot.end,
          `見積もり時間: ${estimatedTime}分`
        );
        if (addEventResult.success) googleEventId = addEventResult.eventId;
      }

      const response = await fetch(`${FLASK_SERVER_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUserId,
          task: {
            title,
            estimatedTime: parseInt(estimatedTime),
            deadline: finalDeadline,
            start: suggestedSlot.start.toISOString(),
            end: suggestedSlot.end.toISOString(),
            completed: false,
            createdAt: new Date().toISOString(),
            hidden: false,
            googleEventId: googleEventId,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "タスクの追加に失敗しました");
      }

      setMessage({ text: `課題「${title}」を追加しました！`, type: "success" });
      fetchTasks();
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskDeadline("");
      setAiDateSuggestion(null);
    } catch (error) {
      setMessage({
        text: `課題の追加中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTaskSubmit = async () => {
    // もし既にAIの提案が表示されているなら、何もしない
    if (aiDateSuggestion) {
      setMessage({
        text: "提案が表示されています。下のボタンから操作してください。",
        type: "info",
      });
      return;
    }

    if (!newTaskTitle.trim()) {
      setMessage({ text: "課題タイトルを入力してください。", type: "error" });
      return;
    }
    if (!googleUserInfo) {
      setMessage({
        text: "課題を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!userPreference) {
      setMessage({
        text: "朝型/夜型の設定を選択してください。",
        type: "error",
      });
      return;
    }
    if (googleAccessToken && newTaskEstimate.trim()) {
      // 最初の提案なので、引数なしで呼び出す
      requestAiSuggestion();
    } else {
      setMessage({
        text: "AI提案には見積もり時間が必要です。",
        type: "error",
      });
    }
  };

  const handleSkipTask = async (taskId) => {
    if (!currentUserId) return;
    const taskToSkip = tasks.find((task) => task.id === taskId);
    if (!taskToSkip) return;

    setIsLoading(true);
    try {
      if (taskToSkip.start && taskToSkip.end) {
        await fetch(`${FLASK_SERVER_URL}/skip-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUserId,
            taskId: taskId,
            startTime: taskToSkip.start,
            endTime: taskToSkip.end,
          }),
        });
      }

      await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          concentrationLevel: 0,
          hidden: true,
        }),
      });

      if (taskToSkip.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToSkip.googleEventId);
      }
      fetchTasks();
      setMessage({ text: "課題をスキップしました。", type: "info" });
    } catch (error) {
      setMessage({
        text: `課題のスキップ中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTaskCompletion = async (taskId, currentStatus) => {
    if (!currentUserId) return;
    const taskToUpdate = tasks.find((task) => task.id === taskId);
    if (!taskToUpdate) return;

    if (!currentStatus) {
      setShowCompletionFeedbackModalForTask(taskToUpdate);
    } else {
      setIsLoading(true);
      try {
        await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            completed: false,
            completedAt: null,
            concentrationLevel: null,
            hidden: false,
          }),
        });
        fetchTasks();
        setMessage({ text: "課題を未完了に戻しました。", type: "info" });
      } catch (error) {
        setMessage({
          text: `課題の完了状態の切り替え中にエラー: ${error.message}`,
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleConfirmCompletion = async (
    taskId,
    concentration,
    completionTime
  ) => {
    if (!currentUserId || !userPreference) {
      setShowCompletionFeedbackModalForTask(null);
      return;
    }

    setIsLoading(true);
    try {
      const taskToComplete = tasks.find((task) => task.id === taskId);
      if (!taskToComplete) throw new Error("対象タスクが見つかりません。");

      const isOverdue =
        taskToComplete.end && new Date() > new Date(taskToComplete.end);

      if (!isOverdue && taskToComplete.start && taskToComplete.end) {
        await fetch(`${FLASK_SERVER_URL}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUserId,
            startTime: taskToComplete.start,
            endTime: taskToComplete.end,
            concentrationRating: concentration,
            react_tasks: tasks.filter((t) => t.id !== taskId),
            existingTasks: tasks.filter(
              (t) => t.id !== taskId && t.start && !t.completed
            ),
          }),
        });
      }

      await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed: true,
          completedAt: completionTime.toISOString(),
          concentrationLevel: concentration,
          hidden: true,
        }),
      });

      if (taskToComplete.googleEventId && !isOverdue) {
        await deleteEventFromGoogleCalendar(taskToComplete.googleEventId);
      }

      fetchTasks();
      setMessage({
        text: "課題完了おめでとうございます！",
        type: "success",
      });
    } catch (error) {
      setMessage({
        text: `完了情報の保存に失敗しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
      setShowCompletionFeedbackModalForTask(null);
    }
  };

  const deleteTask = async (taskId) => {
    if (!currentUserId) return;
    setIsLoading(true);
    try {
      const taskToDelete = tasks.find((task) => task.id === taskId);
      if (taskToDelete && taskToDelete.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToDelete.googleEventId);
      }
      await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
        method: "DELETE",
      });
      fetchTasks();
      setMessage({ text: "課題を削除しました。", type: "info" });
    } catch (error) {
      setMessage({ text: "課題の削除中にエラー。", type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveUserPreference = async (preference) => {
    // 既に同じ設定が選択されている場合は、API呼び出しをスキップする
    if (preference === userPreference) {
      return;
    }

    if (!currentUserId) return;
    setIsLoading(true);
    try {
      const response = await fetch(
        `${FLASK_SERVER_URL}/user-preference/${currentUserId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferenceType: preference }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "ユーザー設定の保存に失敗");
      }
      setUserPreference(preference);

      // 設定が完了したら、スムーズに次の操作に移れるようUIを更新する
      setShowUserPreference(false);
      setShowTaskInput(true);

      setMessage({ text: "ユーザー設定を保存しました！", type: "success" });
    } catch (error) {
      setMessage({
        text: `ユーザー設定の保存中にエラー: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetModel = async () => {
    if (!currentUserId) return;

    // 確認ダイアログを表示
    if (
      window.confirm(
        "本当に学習データをリセットしますか？\nこれまでの学習履歴はすべて失われ、最初の状態に戻ります。"
      )
    ) {
      setIsLoading(true);
      try {
        const response = await fetch(
          `${FLASK_SERVER_URL}/reset-model/${currentUserId}`,
          {
            method: "POST",
          }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "リセットに失敗しました。");
        }
        setMessage({
          text: "学習データをリセットしました。次回から新しい設定で学習が始まります。",
          type: "success",
        });
        // UIの状態をリフレッシュするために設定を再取得
        fetchUserPreference();
      } catch (error) {
        setMessage({
          text: `リセット中にエラーが発生しました: ${error.message}`,
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const getTaskCardBgColor = (task) => {
    if (task.completed) return "bg-green-100 border-green-500";
    if (task.end && new Date() > new Date(task.end) && !task.completed) {
      return "bg-gray-200 border-gray-400";
    }
    if (task.start) {
      const diffHours = (new Date(task.start) - new Date()) / 36e5;
      if (diffHours < 24) return "bg-red-100 border-red-500";
      if (diffHours < 72) return "bg-yellow-100 border-yellow-500";
    }
    return "bg-indigo-50 border-indigo-300";
  };

  const visibleTasks = googleUserInfo
    ? tasks.filter((task) => !task.hidden)
    : [];

  if (!isAuthReady) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-purple-100 to-indigo-200 flex flex-col items-center justify-center z-50">
        <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-white mb-6"></div>
        <p className="text-white text-2xl font-semibold">準備中です…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-100 p-2 sm:p-4 font-inter text-gray-800">
      {isLoading && (
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
            AI課題プランナー
          </h1>
          <p className="text-md sm:text-lg text-gray-600">
            AIがあなたの学習計画を自動で最適化します
          </p>
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
              onClick={handleGoogleLoginClick}
              className="flex items-center px-5 py-2.5 bg-white text-gray-700 rounded-full shadow-md hover:bg-gray-100 transition duration-300 transform hover:scale-105 border border-gray-300"
            >
              <img
                src="https://developers.google.com/identity/images/g-logo.png"
                alt="Google Logo"
                className="w-5 h-5 mr-2.5"
              />
              <LogIn className="mr-1.5 h-5 w-5 text-indigo-600" />{" "}
              Googleカレンダー連携で自動スケジューリング
            </button>
            <p className="text-xs text-gray-500 mt-2">
              Googleカレンダーと連携すると、AIが空き時間を見つけて課題を提案します。
            </p>
          </section>
        )}

        {googleUserInfo && (
          <CollapsibleSection
            title="ユーザー設定"
            icon={<User className="h-6 w-6 text-purple-500" />}
            isOpen={showUserPreference}
            setIsOpen={setShowUserPreference}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  あなたは朝型ですか、夜型ですか？
                </label>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <label
                    className={`flex items-center p-3 rounded-lg border shadow-sm transition flex-1 ${
                      userPreference !== null
                        ? "opacity-70 cursor-not-allowed bg-gray-100"
                        : "cursor-pointer bg-blue-50 border-blue-200 hover:bg-blue-100"
                    }`}
                  >
                    <input
                      type="radio"
                      name="userPreference"
                      value="morning"
                      checked={userPreference === "morning"}
                      onChange={(e) => handleSaveUserPreference(e.target.value)}
                      disabled={userPreference !== null}
                      className="form-radio h-5 w-5 text-blue-600"
                    />
                    <Sun className="ml-2 mr-1 h-5 w-5 text-blue-500" />
                    <span className="text-base font-medium text-gray-800">
                      朝型
                    </span>
                  </label>
                  <label
                    className={`flex items-center p-3 rounded-lg border shadow-sm transition flex-1 ${
                      userPreference !== null
                        ? "opacity-70 cursor-not-allowed bg-gray-100"
                        : "cursor-pointer bg-indigo-50 border-indigo-200 hover:bg-indigo-100"
                    }`}
                  >
                    <input
                      type="radio"
                      name="userPreference"
                      value="night"
                      checked={userPreference === "night"}
                      onChange={(e) => handleSaveUserPreference(e.target.value)}
                      disabled={userPreference !== null}
                      className="form-radio h-5 w-5 text-indigo-600"
                    />
                    <Moon className="ml-2 mr-1 h-5 w-5 text-indigo-500" />
                    <span className="text-base font-medium text-gray-800">
                      夜型
                    </span>
                  </label>
                </div>
              </div>
              {!userPreference && (
                <p className="text-sm text-red-500 text-center">
                  AI提案を最適化するために、朝型か夜型かを選択してください。
                </p>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={handleResetModel}
                className="flex items-center px-4 py-2 bg-red-100 text-red-700 text-sm rounded-full shadow-sm hover:bg-red-200 transition duration-300"
                title="学習データを初期状態に戻します"
              >
                <RotateCw className="h-4 w-4 mr-2" />
                学習データをリセット
              </button>
            </div>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title={"新しい課題を追加"}
          icon={<Plus className="h-6 w-6 text-indigo-500" />}
          isOpen={showTaskInput}
          setIsOpen={setShowTaskInput}
        >
          <fieldset disabled={!userPreference}>
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
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                  placeholder="例: 卒業論文を書く"
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
                    見積もり時間 (分) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    id="taskEstimate"
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                    placeholder="例: 180"
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
                    希望の期限
                  </label>
                  <input
                    type="date"
                    id="taskDeadline"
                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                    value={newTaskDeadline}
                    onChange={(e) => setNewTaskDeadline(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                  />
                </div>
              </div>
            </div>

            {aiDateSuggestion ? (
              <div className="mt-4 p-3 bg-indigo-50 rounded-lg space-y-3">
                <p className="font-semibold text-center text-indigo-800">
                  AIの提案:{" "}
                  <span className="font-bold">
                    {new Date(
                      aiDateSuggestion.suggestedSlot.start
                    ).toLocaleString("ja-JP", {
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Tokyo",
                    })}
                  </span>{" "}
                  でいかがですか？
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={confirmAndAddTask}
                    className="flex items-center px-4 py-2 bg-green-500 text-white rounded-full shadow hover:bg-green-600 transition"
                  >
                    <ThumbsUp className="h-4 w-4 mr-1.5" /> この日で決定
                  </button>
                  <button
                    onClick={handleRejectAndResuggest}
                    className="flex items-center px-4 py-2 bg-yellow-500 text-white rounded-full shadow hover:bg-yellow-600 transition"
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" /> 別の時間を探す
                  </button>
                  <button
                    onClick={() => setAiDateSuggestion(null)}
                    className="flex items-center px-4 py-2 bg-gray-400 text-white rounded-full shadow hover:bg-gray-500 transition"
                  >
                    <XCircle className="h-4 w-4 mr-1.5" /> キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3 mt-4">
                <button
                  onClick={handleTaskSubmit}
                  disabled={isLoading || !userPreference}
                  className="flex-1 flex items-center justify-center px-5 py-2.5 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="mr-2 h-5 w-5" /> AIが日時を入れて課題追加
                </button>
              </div>
            )}
          </fieldset>

          {!userPreference && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-center text-sm text-yellow-800 animate-fade-in-down">
              <p>
                まず「ユーザー設定」で朝型か夜型を選択してください。設定が完了すると、課題を追加できるようになります。
              </p>
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="あなたの課題リスト"
          icon={<Zap className="h-6 w-6 text-green-500" />}
          isOpen={showTaskList}
          setIsOpen={setShowTaskList}
        >
          {visibleTasks.length === 0 ? (
            googleUserInfo ? (
              <p className="text-gray-500 text-center py-4">
                表示する課題がありません。
              </p>
            ) : (
              <p className="text-gray-500 text-center py-4">
                課題を保存・表示するにはGoogleログインが必要です。
              </p>
            )
          ) : (
            <ul className="space-y-3">
              {visibleTasks.map((task) => {
                const isOverdue =
                  task.end &&
                  new Date() > new Date(task.end) &&
                  !task.completed;

                return (
                  <li
                    key={task.id}
                    className={`p-3 rounded-lg shadow-sm border-l-4 transition-all ${getTaskCardBgColor(
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
                          {isOverdue && (
                            <span className="ml-2 text-red-600">
                              (期限切れ)
                            </span>
                          )}
                        </h3>
                        <div className="flex flex-wrap items-center text-xs text-gray-600 mt-0.5 gap-x-2">
                          {task.estimatedTime > 0 && !task.completed && (
                            <span className="flex items-center">
                              <Clock className="h-3.5 w-3.5 mr-0.5" />{" "}
                              {task.estimatedTime} 分
                            </span>
                          )}
                          {task.start && !task.completed && (
                            <span className={`flex items-center font-semibold`}>
                              <Calendar className="h-3.5 w-3.5 mr-0.5" />{" "}
                              提案日時:{" "}
                              {new Date(task.start).toLocaleString("ja-JP", {
                                month: "long",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "Asia/Tokyo",
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 ml-2">
                        {!task.completed ? (
                          <>
                            {isOverdue && task.start ? (
                              <button
                                onClick={() => handleSkipTask(task.id)}
                                className="p-1.5 rounded-full bg-gray-500 hover:bg-gray-600 text-white shadow-sm transition"
                                title="スキップ"
                              >
                                <Rewind className="h-4 w-4" />
                              </button>
                            ) : null}
                            <button
                              onClick={() =>
                                toggleTaskCompletion(task.id, task.completed)
                              }
                              className={`p-1.5 rounded-full transition shadow-sm ${
                                isOverdue
                                  ? "bg-purple-500 hover:bg-purple-600"
                                  : "bg-green-500 hover:bg-green-600"
                              } text-white`}
                              title={
                                isOverdue
                                  ? "完了にする (期限切れ)"
                                  : "完了にする"
                              }
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() =>
                              toggleTaskCompletion(task.id, task.completed)
                            }
                            className="p-1.5 rounded-full bg-gray-400 hover:bg-gray-500 text-white shadow-sm transition"
                            title="未完了に戻す"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-1.5 rounded-full bg-red-400 hover:bg-red-500 text-white shadow-sm transition"
                          title="削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleSection>

        <footer className="text-center text-gray-500 text-xs pt-6 border-t border-gray-200">
          <p>&copy; 2025 AI課題プランナー</p>
        </footer>
      </div>

      {showCompletionFeedbackModalForTask && (
        <CompletionFeedbackModal
          task={showCompletionFeedbackModalForTask}
          onClose={() => setShowCompletionFeedbackModalForTask(null)}
          onSave={handleConfirmCompletion}
          isLoading={isLoading}
        />
      )}

      <style>{`
        @keyframes fade-in-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-down { animation: fade-in-down 0.4s ease-out forwards; }
        @keyframes pulse { 50% { opacity: .7; } }
        .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>
    </div>
  );
}

const CollapsibleSection = ({ title, icon, children, isOpen, setIsOpen }) => (
  <section className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
    <button
      onClick={() => setIsOpen(!isOpen)}
      className="w-full flex items-center justify-between p-3 sm:p-4 bg-gray-50 hover:bg-gray-100 transition focus:outline-none"
    >
      <div className="flex items-center">
        {icon && <span className="mr-2 text-indigo-600">{icon}</span>}
        <h2 className="text-lg sm:text-xl font-bold text-gray-700">{title}</h2>
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

export default function App() {
  return <MainAppContent />;
}
