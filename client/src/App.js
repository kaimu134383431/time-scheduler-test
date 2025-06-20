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
  Edit3,
  Trash2,
  RotateCcw,
  Repeat, // For rescheduling
  BarChart, // For stats
  Star, // For ratings
  ThumbsUp,
  RefreshCw,
  XCircle,
  Clock9, // For fixed unavailability
  CalendarCheck, // For fixed unavailability list
} from "lucide-react";

// Firebase configuration placeholder - This setting will be overwritten by __firebase_config provided by the Canvas environment.
// For local development and testing, you can put your actual Firebase configuration here.
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

// Google OAuth Client ID - This should ideally be fetched from environment variables.
// It is directly written here for testing purposes, but caution is advised in production environments.
const GOOGLE_CLIENT_ID =
  "658537863941-7faa9ifaqso60b9kks1m6l4h4tgmt7up.apps.googleusercontent.com";

// Day of the week mapping
const DAY_OF_WEEK_MAP = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

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
              name={`rating-${Math.random()}`} // Generate unique name attribute
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
// Modal for inputting feedback (concentration level and completion time) when a task is completed.
const CompletionFeedbackModal = ({ task, onClose, onSave, isLoading }) => {
  // デフォルトを0に変更 (ユーザーの要望)
  const [concentrationRating, setConcentrationRating] = useState(0); 
  const [completionDateTime, setCompletionDateTime] = useState(() => {
    const now = new Date();
    // Generate YYYY-MM-DDTHH:MM format string
    return `${now.getFullYear()}-${(now.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}T${now
      .getHours()
      .toString()
      .padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  });

  const handleSave = () => {
    onSave(task.id, concentrationRating, new Date(completionDateTime));
  };

  if (!task) return null;

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-5 transform animate-fade-in-down">
        <h2 className="text-2xl font-bold text-center text-indigo-700">
          課題完了おめでとうございます！
        </h2>
        <p className="text-center text-gray-600 text-lg">
          「<span className="font-semibold">{task.title}</span>」を完了しました
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
  // const [db, setDb] = useState(null); // Firestore db state removed
  const [auth, setAuth] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const authCheckCompletedRef = useRef(false); // Add a new ref

  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [editingTask, setEditingTask] = useState(null);

  const [rescheduleInputs, setRescheduleInputs] = useState({});

  const [taskStats, setTaskStats] = useState({ week: 0, month: 0 });

  const [message, setMessage] = useState({ text: "", type: "info" });
  const [aiDateSuggestion, setAiDateSuggestion] = useState(null);

  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleUserInfo, setGoogleUserInfo] = useState(null);
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [googleTokenClient, setGoogleTokenClient] = useState(null);

  // New state: user-defined fixed unavailability
  const [userDefinedUnavailableSlots, setUserDefinedUnavailableSlots] =
    useState([]);
  const [selectedUnavailableDays, setSelectedUnavailableDays] = useState([]); // For multiple selection
  const [newUnavailableStartTime, setNewUnavailableStartTime] =
    useState("09:00");
  const [newUnavailableEndTime, setNewUnavailableEndTime] = useState("17:00");
  const [newUnavailableLabel, setNewUnavailableLabel] = useState("");

  const [showTaskInput, setShowTaskInput] = useState(true);
  const [showTaskList, setShowTaskList] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [showUnavailableSlots, setShowUnavailableSlots] = useState(false); // Fixed unavailability section

  // State to control the display of the modal for entering concentration level and completion time
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

      // Check if Firebase configuration is incomplete
      if (
        !firebaseConfig.projectId ||
        firebaseConfig.projectId === "YOUR_PROJECT_ID"
      ) {
        console.error("Firebase configuration is missing or incomplete.");
        setMessage({
          text: "Firebase設定が不完全です。管理者に問い合わせるか、Firebase設定を確認してください。",
          type: "error",
        });
        // Even if Firebase is not configured, set authReady to true to display the UI.
        setIsAuthReady(true);
        return;
      }

      const app = initializeApp(firebaseConfig);
      // const firestore = getFirestore(app); // Firestore initialization removed
      const firebaseAuth = getAuth(app);
      // setDb(firestore); // Setting db state removed
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (!authCheckCompletedRef.current) {
          // Run only once initially
          authCheckCompletedRef.current = true; // Mark check as complete

          if (user) {
            setCurrentUserId(user.uid);
          } else {
            // If initialAuthToken is available, sign in with custom token, otherwise sign in anonymously
            try {
              if (initialAuthToken) {
                await signInWithCustomToken(firebaseAuth, initialAuthToken);
              } else {
                await signInAnonymously(firebaseAuth);
              }
              // After signing in, set the current user ID
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
              // Even if an error occurs, try to sign in anonymously
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
          // Once all initial authentication processes are complete, set isAuthReady to true
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
      setIsAuthReady(true); // Release loading screen even on initialization error
    }
  }, []);

  // --- Google GSI Client Initialization ---
  useEffect(() => {
    // Check if GOOGLE_CLIENT_ID is set
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
      const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'タスクリストの取得に失敗しました');
      }
      let fetchedTasks = await response.json();

      // FireStoreと同様のソートロジックを適用
      fetchedTasks.sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          const deadlineA = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const deadlineB = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          if (deadlineA !== deadlineB) return deadlineA - deadlineB;
          const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return createdAtA - createdAtB;
      });

      setTasks(fetchedTasks.filter(task => !task.hidden)); // hiddenなタスクは非表示
      setMessage({ text: "課題リストを更新しました。", type: "info" });
    } catch (error) {
      console.error("Error fetching tasks:", error);
      setMessage({ text: `課題の取得中にエラーが発生しました: ${error.message}`, type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
      if (currentUserId && googleUserInfo) { // 認証とGoogleログインが完了したら
          fetchTasks();
      } else {
          setTasks([]); // ログアウト時や未認証時はタスクをクリア
      }
  }, [currentUserId, googleUserInfo]); // 依存配列にcurrentUserIdとgoogleUserInfoを追加

  // --- Fetch Unavailable Slots from Flask Backend ---
  const fetchUnavailableSlots = async () => {
    if (!currentUserId || !googleUserInfo) {
        setUserDefinedUnavailableSlots([]);
        return;
    }
    setIsLoading(true);
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/unavailable-slots/${currentUserId}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '固定の予定リストの取得に失敗しました');
        }
        const fetchedSlots = await response.json();
        setUserDefinedUnavailableSlots(fetchedSlots);
    } catch (error) {
        console.error("Error fetching unavailable slots:", error);
        setMessage({ text: `固定の予定の取得中にエラーが発生しました: ${error.message}`, type: "error" });
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
      if (currentUserId && googleUserInfo) {
          fetchUnavailableSlots();
      } else {
          setUserDefinedUnavailableSlots([]);
      }
  }, [currentUserId, googleUserInfo]);

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

  // --- Helper function to generate recurring unavailability slots (no change, but note it's client-side) ---
  // This client-side function is kept for consistency with how Google Calendar events were handled locally.
  // However, the Flask backend's prepare_inputs_from_react will also handle unavailable slots from the API.
  const generateRecurringSlots = (
    unavailableSlots,
    searchStartDate,
    searchEndDate
  ) => {
    const generatedSlots = [];
    const startOfDaySearch = new Date(searchStartDate);
    startOfDaySearch.setHours(0, 0, 0, 0);

    for (
      let d = new Date(startOfDaySearch);
      d.getTime() <= searchEndDate.getTime();
      d.setDate(d.getDate() + 1)
    ) {
      const currentDayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday

      unavailableSlots.forEach((slot) => {
        const isMatchingDay =
          Array.isArray(slot.dayOfWeek) &&
          slot.dayOfWeek.includes(currentDayOfWeek.toString());

        if (isMatchingDay) {
          let slotStart = new Date(d);
          slotStart.setHours(
            parseInt(slot.startTime.split(":")[0]),
            parseInt(slot.startTime.split(":")[1]),
            0,
            0
          );

          let slotEnd = new Date(d);
          slotEnd.setHours(
            parseInt(slot.endTime.split(":")[0]),
            parseInt(slot.endTime.split(":")[1]),
            0,
            0
          );

          if (slotEnd.getTime() <= slotStart.getTime()) {
            slotEnd.setDate(slotEnd.getDate() + 1);
          }

          if (slotEnd > searchStartDate && slotStart < searchEndDate) {
            generatedSlots.push({
              start: slotStart,
              end: slotEnd,
              summary: slot.label || "固定の予定",
              isUserDefined: true,
            });
          }
        }
      });
    }
    return generatedSlots;
  };

  // --- Google Calendar Event Management ---
  const addEventToGoogleCalendar = async (
    title,
    startTime,
    endTime,
    description = ""
  ) => {
    if (!googleAccessToken) {
      console.warn(
        "Google Access Token not available. Cannot add event to Google Calendar."
      );
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
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
        console.error("Error adding event to Google Calendar:", errorData);
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
      console.error("Error adding event to Google Calendar:", error);
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
      console.warn(
        "Google Access Token not available. Cannot delete event from Google Calendar."
      );
      setMessage({
        text: "Googleカレンダー連携が有効ではありません。イベントを削除できません。",
        type: "warning",
      });
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

      if (!response.ok) {
        if (response.status !== 204) {
          const errorData = await response.json();
          console.error(
            "Error deleting event from Google Calendar:",
            errorData
          );
          setMessage({
            text: `Googleカレンダーからの削除に失敗しました: ${errorData.error.message}`,
            type: "error",
          });
          return false;
        }
      }

      setMessage({
        text: "Googleカレンダーからイベントを削除しました。",
        type: "info",
      });
      return true;
    } catch (error) {
      console.error("Error deleting event from Google Calendar:", error);
      setMessage({
        text: "Googleカレンダーからの削除中にエラーが発生しました。",
        type: "error",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // --- Task Management ---
  const requestAiSuggestion = async () => { // searchAfter removed, AI handles from current time
    if (!googleUserInfo) {
      setMessage({
        text: "AI提案を利用するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!newTaskTitle.trim() || !newTaskEstimate.trim()) {
      setMessage({ text: "課題タイトルと見積もり時間は必須です。", type: "error" });
      return;
    }

    setIsLoading(true);
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/suggest-slot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: currentUserId,
                task: {
                    id: 'temp-' + Date.now(), // 一時的なID
                    title: newTaskTitle,
                    estimatedTime: parseInt(newTaskEstimate),
                    deadline: newTaskDeadline || null, // 期限がない場合も考慮
                },
                unavailableSlots: userDefinedUnavailableSlots, // 固定の予定もAIに渡す
                // Google Calendar イベントもAIに渡す場合はここに追加
                // googleEvents: googleEvents.map(e => ({ start: e.start, end: e.end, summary: e.summary })),
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'AI提案の取得に失敗しました');
        }

        const suggestion = await response.json();
        setAiDateSuggestion({
            title: newTaskTitle,
            estimatedTime: newTaskEstimate,
            suggestedSlot: { // バックエンドから返る形式に合わせる
                start: new Date(suggestion.start),
                end: new Date(suggestion.end),
            },
        });
        setMessage({ text: "AIが最適な日時を提案しました！", type: "info" });
    } catch (error) {
        console.error("Error requesting AI suggestion:", error);
        setMessage({ text: `AI提案中にエラーが発生しました: ${error.message}`, type: "error" });
    } finally {
        setIsLoading(false);
    }
  };

  const confirmAndAddTask = async () => {
    if (!googleUserInfo || !currentUserId || !aiDateSuggestion) {
      setMessage({
        text: "必要な情報が揃っていません。",
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    const { title, estimatedTime, suggestedSlot } = aiDateSuggestion;
    const finalDeadline = suggestedSlot.start.toISOString().split("T")[0];

    try {
      let googleEventId = null;
      if (googleAccessToken) {
        const eventDescription = `見積もり時間: ${estimatedTime}分`;
        const addEventResult = await addEventToGoogleCalendar(
          title, suggestedSlot.start, suggestedSlot.end, eventDescription
        );
        if (addEventResult.success) {
          googleEventId = addEventResult.eventId;
        } else {
          console.warn("Failed to add event to Google Calendar.");
        }
      }

      // 新しいタスクをバックエンドAPIを通じて追加
      const response = await fetch(`${FLASK_SERVER_URL}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              userId: currentUserId,
              task: {
                  title,
                  estimatedTime: parseInt(estimatedTime),
                  deadline: finalDeadline,
                  completed: false,
                  createdAt: new Date().toISOString(),
                  completedAt: null,
                  concentrationLevel: null,
                  hidden: false,
                  googleEventId: googleEventId,
                  rescheduled: false,
              },
          }),
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'タスクの追加に失敗しました');
      }

      setMessage({ text: `課題「${title}」を追加しました！`, type: "success" });

      fetchTasks(); // 成功後、タスクリストを更新するために再フェッチ

      // フォームをリセット
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskDeadline("");
      setAiDateSuggestion(null);
      setEditingTask(null);

    } catch (error) {
      console.error("Error confirming and adding task:", error);
      setMessage({ text: `課題の追加中にエラーが発生しました: ${error.message}`, type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTaskSubmit = async () => {
    // --- Validation for all modes ---
    if (!newTaskTitle.trim()) {
      setMessage({ text: "課題タイトルを入力してください。", type: "error" });
      return;
    }

    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "課題を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }

    // AI suggestion mode
    if (googleAccessToken && newTaskEstimate.trim() && !editingTask) {
      requestAiSuggestion();
    } else {
      // Manual mode: requires all fields except AI's if AI mode is not active
      if (!newTaskEstimate.trim() || !newTaskDeadline.trim()) {
        setMessage({
          text: "見積もり時間と希望の期限を入力してください。",
          type: "error",
        });
        return;
      }

      if (!currentUserId) {
        setMessage({
          text: "ユーザー情報が取得できません。",
          type: "error",
        });
        return;
      }

      setIsLoading(true);
      try {
        const taskData = {
          title: newTaskTitle,
          estimatedTime: parseInt(newTaskEstimate),
          deadline: newTaskDeadline,
          completed: false,
          createdAt: new Date().toISOString(),
          completedAt: null,
          concentrationLevel: null,
          hidden: false,
          googleEventId: null, // Manually added tasks don't have a Google Event ID initially.
        };

        if (editingTask) {
            const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${editingTask.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '課題の更新に失敗しました');
            }
            setMessage({
                text: `課題「${newTaskTitle}」を更新しました！`,
                type: "success",
            });
        } else {
            const response = await fetch(`${FLASK_SERVER_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUserId,
                    task: taskData,
                }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '課題の追加に失敗しました');
            }
            setMessage({
                text: `課題「${newTaskTitle}」を追加しました！`,
                type: "success",
            });
        }
        
        fetchTasks(); // リストを更新
        setNewTaskTitle("");
        setNewTaskEstimate("");
        setNewTaskDeadline("");
        setEditingTask(null);
      } catch (error) {
        console.error("Error saving task manually:", error);
        setMessage({
          text: "課題の保存中にエラーが発生しました。",
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const startEditTask = (task) => {
    if (!googleUserInfo) {
      setMessage({
        text: "課題を編集するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    setEditingTask(task);
    setNewTaskTitle(task.title);
    setNewTaskEstimate(task.estimatedTime?.toString() || "");
    setNewTaskDeadline(task.deadline || "");
    setShowTaskInput(true);
    if (taskInputRef.current) taskInputRef.current.focus();
  };

  const toggleTaskCompletion = async (taskId, currentStatus) => {
    if (!googleUserInfo) {
      setMessage({
        text: "課題の完了状態を更新するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!currentUserId) {
      setMessage({
        text: "ユーザー情報が取得できません。",
        type: "error",
      });
      return;
    }

    const taskToUpdate = tasks.find((task) => task.id === taskId);
    if (!taskToUpdate) {
      console.error("Task not found for toggling completion:", taskId);
      return;
    }

    // If changing from uncompleted to completed
    if (!currentStatus) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const deadlineDate = taskToUpdate.deadline
        ? new Date(taskToUpdate.deadline)
        : null;
      if (deadlineDate) {
        deadlineDate.setHours(0, 0, 0, 0);
      }

      if (deadlineDate && deadlineDate >= now) {
        setShowCompletionFeedbackModalForTask(taskToUpdate);
        return;
      } else if (taskToUpdate.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToUpdate.googleEventId);
      }
    } else {
      setIsLoading(true);
      try {
        const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                completed: false,
                completedAt: null,
                concentrationLevel: null,
                hidden: false,
                googleEventId: null, // Clear the Google event ID when reverting to uncompleted
            }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'タスク状態の更新に失敗しました');
        }
        setMessage({ text: "課題を未完了に戻しました。", type: "info" });
      } catch (error) {
        console.error("Error reverting task completion:", error);
        setMessage({
          text: "課題の完了状態の切り替え中にエラーが発生しました。",
          type: "error",
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                completed: true,
                completedAt: new Date().toISOString(),
                // concentrationLevel remains null here, set by modal
                // hidden remains false here, set by modal
            }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'タスク状態の更新に失敗しました');
        }
        setMessage({
            text: "課題を完了しました！お疲れ様でした。",
            type: "success",
        });
    } catch (error) {
      console.error("Error toggling task completion:", error);
      setMessage({
        text: "課題の完了状態の切り替え中にエラーが発生しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCompletion = async (
    taskId,
    concentration,
    completionTime
  ) => {
    if (!googleUserInfo || !currentUserId) {
      setMessage({
        text: "課題の完了情報を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      setShowCompletionFeedbackModalForTask(null);
      return;
    }

    setIsLoading(true);
    try {
      const taskToComplete = tasks.find((task) => task.id === taskId);

      // フィードバックをバックエンドAPIに送信
      const feedbackResponse = await fetch(`${FLASK_SERVER_URL}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              userId: currentUserId,
              completionTime: completionTime.toISOString(),
              concentrationRating: concentration,
          }),
      });

      if (!feedbackResponse.ok) {
          const errorData = await feedbackResponse.json();
          throw new Error(errorData.error || 'フィードバックの送信に失敗しました');
      }

      // タスクの完了ステータスをバックエンドAPIを通じて更新
      const updateTaskResponse = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              completed: true,
              completedAt: completionTime.toISOString(),
              concentrationLevel: concentration,
              hidden: true, // Hide from list after completion
          }),
      });

      if (!updateTaskResponse.ok) {
          const errorData = await updateTaskResponse.json();
          throw new Error(errorData.error || 'タスク状態の更新に失敗しました');
      }

      if (taskToComplete && taskToComplete.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToComplete.googleEventId);
        // Google Event IDをAPIを通じてクリア
        await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ googleEventId: null }),
        });
      }

      setMessage({
        text: "素晴らしい！集中して課題を終えましたね！報酬獲得！",
        type: "success",
      });
      fetchTasks(); // リストを更新
    } catch (error) {
      console.error("Error saving concentrated completion:", error);
      setMessage({
        text: "課題の完了情報の保存に失敗しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
      setShowCompletionFeedbackModalForTask(null); // Close modal
    }
  };

  const deleteTask = async (taskId) => {
    if (!googleUserInfo) {
      setMessage({
        text: "課題を削除するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!currentUserId) {
      setMessage({
        text: "ユーザー情報が取得できません。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
      const taskToDelete = tasks.find((task) => task.id === taskId);

      if (taskToDelete && taskToDelete.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToDelete.googleEventId);
      }

      const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
          method: 'DELETE',
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'タスクの削除に失敗しました');
      }
      setMessage({ text: "課題を削除しました。", type: "info" });
      fetchTasks(); // リストを更新
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

  const saveConcentration = async (taskId, rating) => {
    if (!googleUserInfo) {
      setMessage({
        text: "集中度を記録するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!currentUserId) {
      setMessage({
        text: "ユーザー情報が取得できません。",
        type: "error",
      });
      return;
    }
    if (rating == null || rating < 1 || rating > 5) {
      setMessage({
        text: "集中度は1から5の間で入力してください。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concentrationLevel: rating, hidden: true }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '集中度の保存に失敗しました');
        }
        setMessage({
            text: "集中度を記録しました！お疲れ様でした。",
            type: "success",
        });
        fetchTasks(); // リストを更新
    } catch (error) {
      console.error("Error saving concentration:", error);
      setMessage({ text: "集中度の保存に失敗しました。", type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const rescheduleTask = async (taskId) => {
    if (!googleUserInfo) {
      setMessage({
        text: "課題を再入力するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!currentUserId) {
      setMessage({
        text: "ユーザー情報が取得できません。",
        type: "error",
      });
      return;
    }
    const additionalTime = rescheduleInputs[taskId];
    if (!additionalTime || additionalTime <= 0) {
      setMessage({
        text: "追加でかかる時間を分単位で入力してください。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
      const taskToReschedule = tasks.find((task) => task.id === taskId);

      if (taskToReschedule && taskToReschedule.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToReschedule.googleEventId);
      }

      const response = await fetch(`${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              estimatedTime: parseInt(additionalTime), // Overwrite existing estimated time
              deadline: null, // Reset deadline
              completed: false,
              rescheduled: true, // Reschedule flag
              googleEventId: null, // Clear Google Event ID after deletion
          }),
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '課題の再入力に失敗しました');
      }
      setMessage({ text: "課題を再入力しました。", type: "success" });
      setRescheduleInputs((prev) => ({ ...prev, [taskId]: "" })); // Clear input field
      fetchTasks(); // リストを更新
    } catch (error) {
      console.error("Error rescheduling task:", error);
      setMessage({ text: "課題の再入力に失敗しました。", type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  // --- Unavailable Slots Management ---
  const handleDayChange = (e) => {
    const day = e.target.value;
    setSelectedUnavailableDays((prev) =>
      e.target.checked
        ? [...prev, day].sort()
        : prev.filter((d) => d !== day).sort()
    );
  };

  const handleSelectAllDays = (e) => {
    if (e.target.checked) {
      setSelectedUnavailableDays(["0", "1", "2", "3", "4", "5", "6"]);
    } else {
      setSelectedUnavailableDays([]);
    }
  };

  const handleAddUnavailableSlot = async () => {
    if (!googleUserInfo) {
      setMessage({
        text: "固定の予定を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!currentUserId) {
      setMessage({
        text: "ユーザー情報が取得できません。",
        type: "error",
      });
      return;
    }
    if (selectedUnavailableDays.length === 0) {
      setMessage({
        text: "曜日を少なくとも1つ選択してください。",
        type: "error",
      });
      return;
    }
    if (!newUnavailableStartTime || !newUnavailableEndTime) {
      setMessage({
        text: "開始時間と終了時間を入力してください。",
        type: "error",
      });
      return;
    }
    if (newUnavailableStartTime === newUnavailableEndTime) {
      setMessage({
        text: "開始時間と終了時間は同じにできません。",
        type: "error",
      });
      return;
    }

    const [startHour, startMinute] = newUnavailableStartTime
      .split(":")
      .map(Number);
    const [endHour, endMinute] = newUnavailableEndTime.split(":").map(Number);

    if (
      startHour * 60 + startMinute > endHour * 60 + endMinute &&
      !(endHour < startHour)
    ) {
      setMessage({
        text: "開始時間は終了時間より前にしてください。(日をまたぐ設定は可能です)",
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    try {
      const slotData = {
        dayOfWeek: selectedUnavailableDays,
        startTime: newUnavailableStartTime,
        endTime: newUnavailableEndTime,
        label:
          newUnavailableLabel.trim() ||
          `毎週 ${selectedUnavailableDays
            .map((d) => DAY_OF_WEEK_MAP[parseInt(d)])
            .join(", ")} の固定予定`,
        createdAt: new Date().toISOString(),
      };
      const response = await fetch(`${FLASK_SERVER_URL}/unavailable-slots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, slot: slotData }),
      });
      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '固定の予定の追加に失敗しました');
      }
      setMessage({
        text: `固定の予定「${slotData.label}」を追加しました！`,
        type: "success",
      });
      fetchUnavailableSlots(); // リストを更新
      setSelectedUnavailableDays([]);
      setNewUnavailableStartTime("09:00");
      setNewUnavailableEndTime("17:00");
      setNewUnavailableLabel("");
    } catch (error) {
      console.error("Error adding unavailable slot:", error);
      setMessage({
        text: `固定の予定の追加中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUnavailableSlot = async (slotId) => {
    if (!googleUserInfo) {
      setMessage({
        text: "固定の予定を削除するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!currentUserId) {
      setMessage({
        text: "ユーザー情報が取得できません。",
        type: "error",
      });
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${FLASK_SERVER_URL}/unavailable-slots/${currentUserId}/${slotId}`, {
          method: 'DELETE',
      });
      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '固定の予定の削除に失敗しました');
      }
      setMessage({ text: "固定の予定を削除しました。", type: "info" });
      fetchUnavailableSlots(); // リストを更新
    } catch (error) {
      console.error("Error deleting unavailable slot:", error);
      setMessage({
        text: "固定の予定の削除中にエラーが発生しました。",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Rendering ---
  const getTaskCardBgColor = (task) => {
    if (task.completed) return "bg-green-100 border-green-500";
    if (task.deadline) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deadlineDate = new Date(task.deadline);
      deadlineDate.setHours(0, 0, 0, 0);
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3);
      threeDaysFromNow.setHours(0, 0, 0, 0);
      if (deadlineDate < today)
        return "bg-red-100 border-red-500 animate-pulse-fast"; // Expired
      if (deadlineDate <= tomorrow) return "bg-red-100 border-red-500"; // Deadline by tomorrow
      if (deadlineDate <= threeDaysFromNow)
        return "bg-yellow-100 border-yellow-500"; // Deadline within 3 days
    }
    if (task.rescheduled) return "bg-blue-100 border-blue-500"; // Rescheduled task
    return "bg-indigo-50 border-indigo-300"; // Default
  };

  const visibleTasks = googleUserInfo
    ? tasks.filter((task) => !task.hidden)
    : [];
  const displayUnavailableSlots = googleUserInfo
    ? userDefinedUnavailableSlots
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
          {currentUserId && (
            <p className="text-xs text-gray-400 mt-1">
              ユーザーID: {currentUserId}
            </p>
          )}{" "}
          {/* Display full user ID */}
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
              Googleカレンダーと連携すると、AIが空き時間を見つけて課題の期限を提案します。課題や固定の予定はGoogleログインした場合のみ保存されます。
            </p>
          </section>
        )}

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
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
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
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
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
                  希望の期限 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="taskDeadline"
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  value={newTaskDeadline}
                  onChange={(e) => setNewTaskDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Google連携時、AIがカレンダーの空き時間から最適な期限を自動で提案します。
            </p>
          </div>

          {aiDateSuggestion ? (
            <div className="mt-4 p-3 bg-indigo-50 rounded-lg space-y-3">
              <p className="font-semibold text-center text-indigo-800">
                AIの提案:{" "}
                <span className="font-bold">
                  {new Date(
                    aiDateSuggestion.suggestedSlot.start
                  ).toLocaleDateString("ja-JP", {
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
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
                  onClick={requestAiSuggestion} // Call AI again for another suggestion
                  className="flex items-center px-4 py-2 bg-yellow-500 text-white rounded-full shadow hover:bg-yellow-600 transition"
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" /> もう一度
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
                disabled={isLoading}
                className="flex-1 flex items-center justify-center px-5 py-2.5 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 transition transform hover:scale-105 disabled:opacity-50"
              >
                <Sparkles className="mr-2 h-5 w-5" />{" "}
                {editingTask ? "課題を更新" : "AIが日時を入れて課題追加"}
              </button>
              {editingTask && (
                <button
                  onClick={() => {
                    setEditingTask(null);
                    setNewTaskTitle("");
                    setNewTaskEstimate("");
                    setNewTaskDeadline("");
                  }}
                  className="sm:flex-none flex items-center justify-center px-5 py-2.5 bg-gray-200 text-gray-700 rounded-full shadow-md hover:bg-gray-300 transition"
                >
                  <RotateCcw className="mr-2 h-5 w-5" /> キャンセル
                </button>
              )}
            </div>
          )}
        </CollapsibleSection>

        {/* New Section: Fixed Unavailability */}
        <CollapsibleSection
          title="固定の予定を追加・管理"
          icon={<Clock9 className="h-6 w-6 text-purple-500" />}
          isOpen={showUnavailableSlots}
          setIsOpen={setShowUnavailableSlots}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-0.5">
                曜日 <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {Object.entries(DAY_OF_WEEK_MAP).map(([key, value]) => (
                  <label key={key} className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      value={key}
                      checked={selectedUnavailableDays.includes(key)}
                      onChange={handleDayChange}
                      className="form-checkbox h-4 w-4 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="ml-1 text-sm text-gray-700">{value}</span>
                  </label>
                ))}
                <label className="flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={selectedUnavailableDays.length === 7}
                    onChange={handleSelectAllDays}
                    className="form-checkbox h-4 w-4 text-purple-600 rounded focus:ring-purple-500"
                  />
                  <span className="ml-1 text-sm text-gray-700 font-bold">
                    毎日
                  </span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="unavailableStartTime"
                  className="block text-sm font-medium text-gray-700 mb-0.5"
                >
                  開始時間 <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  id="unavailableStartTime"
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  value={newUnavailableStartTime}
                  onChange={(e) => setNewUnavailableStartTime(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="unavailableEndTime"
                  className="block text-sm font-medium text-gray-700 mb-0.5"
                >
                  終了時間 <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  id="unavailableEndTime"
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  value={newUnavailableEndTime}
                  onChange={(e) => setNewUnavailableEndTime(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="unavailableLabel"
                className="block text-sm font-medium text-gray-700 mb-0.5"
              >
                ラベル (例: バイト, 就寝)
              </label>
              <input
                type="text"
                id="unavailableLabel"
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                placeholder="例: バイト"
                value={newUnavailableLabel}
                onChange={(e) => setNewUnavailableLabel(e.target.value)}
              />
            </div>
            <button
              onClick={handleAddUnavailableSlot}
              className="w-full flex items-center justify-center px-5 py-2.5 bg-purple-600 text-white rounded-full shadow-md hover:bg-purple-700 transition transform hover:scale-105 disabled:opacity-50"
              disabled={isLoading}
            >
              <Plus className="mr-2 h-5 w-5" /> 固定の予定を追加
            </button>

            <h3 className="text-md font-semibold text-gray-700 mt-6 flex items-center">
              <CalendarCheck className="h-5 w-5 mr-2" />
              登録済みの固定の予定
            </h3>
            {displayUnavailableSlots.length === 0 ? (
              <p className="text-gray-500 text-center py-2">
                固定の予定はまだありません。
              </p>
            ) : (
              <ul className="space-y-2">
                {displayUnavailableSlots.map((slot) => (
                  <li
                    key={slot.id}
                    className="flex items-center justify-between bg-purple-50 p-2.5 rounded-lg border border-purple-200"
                  >
                    <div className="flex-1">
                      <span className="font-semibold text-purple-800">
                        {Array.isArray(slot.dayOfWeek) &&
                        slot.dayOfWeek.length === 7
                          ? "毎日"
                          : Array.isArray(slot.dayOfWeek)
                          ? slot.dayOfWeek
                              .map((d) => DAY_OF_WEEK_MAP[parseInt(d)])
                              .join(", ")
                          : ""}
                      </span>
                      : {slot.startTime} - {slot.endTime} ({slot.label})
                    </div>
                    <button
                      onClick={() => handleDeleteUnavailableSlot(slot.id)}
                      className="ml-2 p-1.5 rounded-full bg-red-400 hover:bg-red-500 text-white shadow-sm transition"
                      title="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
              {visibleTasks.map((task) => (
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
                      </h3>
                      <div className="flex flex-wrap items-center text-xs text-gray-600 mt-0.5 gap-x-2">
                        {task.estimatedTime > 0 && !task.completed && (
                          <span className="flex items-center">
                            <Clock className="h-3.5 w-3.5 mr-0.5" />{" "}
                            {task.estimatedTime} 分
                          </span>
                        )}
                        {task.deadline && !task.completed && (
                          <span
                            className={`flex items-center font-semibold ${
                              getTaskCardBgColor(task).includes("red")
                                ? "text-red-700"
                                : getTaskCardBgColor(task).includes("yellow")
                                ? "text-yellow-700"
                                : ""
                            }`}
                          >
                            <Calendar className="h-3.5 w-3.5 mr-0.5" /> 期限:{" "}
                            {new Date(task.deadline).toLocaleDateString(
                              "ja-JP"
                            )}
                          </span>
                        )}
                        {task.rescheduled && (
                          <span className="text-blue-600 font-semibold">
                            再入力済
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-1.5 ml-2">
                      <button
                        onClick={() =>
                          toggleTaskCompletion(task.id, task.completed)
                        }
                        className={`p-1.5 rounded-full transition shadow-sm ${
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
                        className="p-1.5 rounded-full bg-yellow-400 hover:bg-yellow-500 text-white shadow-sm transition"
                        title="編集"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-1.5 rounded-full bg-red-400 hover:bg-red-500 text-white shadow-sm transition"
                        title="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {task.completed && task.concentrationLevel === null && (
                    <div className="mt-3 pt-3 border-t border-green-200">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">
                          集中度:
                        </span>
                        <StarRating
                          rating={task.concentrationLevel || 0}
                          setRating={(rating) =>
                            saveConcentration(task.id, rating)
                          }
                          readOnly={task.concentrationLevel !== null}
                        />
                      </div>
                    </div>
                  )}

                  {task.deadline &&
                    new Date(task.deadline) < new Date() &&
                    !task.completed && (
                      <div className="mt-3 pt-3 border-t border-red-200">
                        <p className="text-sm font-semibold text-red-700 mb-1">
                          この課題は期限切れです
                        </p>
                        <div className="flex items-center gap-2">
                          <Repeat className="h-5 w-5 text-gray-500" />
                          <input
                            type="number"
                            placeholder="あと何分かかる？"
                            className="w-full text-sm p-1 border border-gray-300 rounded-md"
                            value={rescheduleInputs[task.id] || ""}
                            onChange={(e) =>
                              setRescheduleInputs({
                                ...rescheduleInputs,
                                [task.id]: e.target.value,
                              })
                            }
                          />
                          <button
                            onClick={() => rescheduleTask(task.id)}
                            className="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700"
                          >
                            再入力
                          </button>
                        </div>
                      </div>
                    )}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="あなたの活動記録"
          icon={<BarChart className="h-6 w-6 text-blue-500" />}
          isOpen={showStats}
          setIsOpen={setShowStats}
        >
          <div className="space-y-4 p-2">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-700">
                  過去7日間の完了タスク
                </span>
                <span className="font-bold text-lg text-blue-600">
                  {taskStats.week}件
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{
                    width: `${Math.min(100, (taskStats.week / 7) * 100)}%`,
                  }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-700">
                  過去30日間の完了タスク
                </span>
                <span className="font-bold text-lg text-blue-600">
                  {taskStats.month}件
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{
                    width: `${Math.min(100, (taskStats.month / 20) * 100)}%`,
                  }}
                ></div>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <footer className="text-center text-gray-500 text-xs pt-6 border-t border-gray-200">
          <p>&copy; 2024 AI課題プランナー</p>
        </footer>
      </div>

      {/* Rendering of the concentration feedback modal */}
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
        @keyframes pulse-fast { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }\
        .animate-pulse-fast { animation: pulse-fast 1s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
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
  // GOOGLE_CLIENT_ID check is done inside MainAppContent, so it's removed from here.
  return <MainAppContent />;
}
