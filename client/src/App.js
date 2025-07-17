import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore"; // Firestore imports

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
  BarChart, // For stats
  Star, // For ratings
  ThumbsUp,
  RefreshCw,
  XCircle,
  Clock9, // For fixed unavailability
  CalendarCheck, // For fixed unavailability list
  Rewind, // スキップアイコン用
  Sun, // 朝型アイコン
  Moon, // 夜型アイコン
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
    // 日本時間でYYYY-MM-DDTHH:MM形式の文字列を生成
    const options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23", // 24時間表示
      timeZone: "Asia/Tokyo", // 明示的に日本時間を指定
    };
    const formatter = new Intl.DateTimeFormat("ja-JP", options);
    // formatter.formatToParts() を呼び出して、その結果の配列から各部分を取得
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

  // 課題が期限切れかどうかを判定 (現在時刻を考慮)
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
  const [db, setDb] = useState(null); // Firestore db state
  const [auth, setAuth] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const authCheckCompletedRef = useRef(false); // Add a new ref

  // New states for user profile type and AI model data
  const [userProfileType, setUserProfileType] = useState(null); // 'morning', 'night', or null (not selected)
  const [aiModelData, setAiModelData] = useState(null); // Stores the full AI model data (concentration_map, q_table)
  const [showProfileTypeSelection, setShowProfileTypeSelection] =
    useState(false);

  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");

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
      const firebaseAuth = getAuth(app);
      const firestoreDb = getFirestore(app); // Initialize Firestore
      setAuth(firebaseAuth);
      setDb(firestoreDb); // Set db state

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

  // --- Fetch AI Model Data from Firestore ---
  useEffect(() => {
    const fetchAiModel = async () => {
      if (!db || !currentUserId) return;

      try {
        const modelDocRef = doc(
          db,
          `artifacts/${appId}/users/${currentUserId}/ai_models`,
          "user_model"
        );
        const docSnap = await getDoc(modelDocRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setAiModelData(data.modelData);
          setUserProfileType(data.userType);
          setMessage({ text: "AIモデルをロードしました。", type: "info" });
        } else {
          // モデルが存在しない場合、ユーザーにタイプ選択を促す
          setShowProfileTypeSelection(true);
          setMessage({
            text: "AIの初期設定のため、あなたのタイプを選択してください。",
            type: "info",
          });
        }
      } catch (error) {
        console.error("Error fetching AI model:", error);
        setMessage({
          text: `AIモデルのロード中にエラーが発生しました: ${error.message}`,
          type: "error",
        });
      }
    };

    if (currentUserId && db) {
      fetchAiModel();
    }
  }, [currentUserId, db]);

  // --- Save AI Model Data to Firestore ---
  const saveAiModelToFirestore = async (modelData, userType) => {
    if (!db || !currentUserId) {
      console.warn(
        "Firestore not ready or userId not available for saving AI model."
      );
      return;
    }
    try {
      const modelDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/ai_models`,
        "user_model"
      );
      await setDoc(modelDocRef, { modelData: modelData, userType: userType });
      console.log("AIモデルをFirestoreに保存しました。");
    } catch (error) {
      console.error("Error saving AI model to Firestore:", error);
      setMessage({
        text: `AIモデルの保存中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    }
  };

  // --- Handle User Profile Type Selection ---
  const handleProfileTypeSelection = async (type) => {
    setIsLoading(true);
    try {
      const modelFileName =
        type === "morning"
          ? "morning_person_initial_model.json"
          : "night_owl_initial_model.json";

      // JSONファイルを直接fetchする (public/ 配下にあることを想定)
      const response = await fetch(`/${modelFileName}`);
      if (!response.ok) {
        throw new Error(`Failed to load initial model: ${response.statusText}`);
      }
      const initialModelData = await response.json();

      setAiModelData(initialModelData);
      setUserProfileType(type);
      await saveAiModelToFirestore(initialModelData, type); // 初期モデルをFirestoreに保存
      setShowProfileTypeSelection(false);
      setMessage({
        text: `あなたのタイプを「${
          type === "morning" ? "朝型" : "夜型"
        }」に設定しました。`,
        type: "success",
      });
    } catch (error) {
      console.error("Error setting profile type:", error);
      setMessage({
        text: `プロファイルタイプの設定中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

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

      setTasks(fetchedTasks.filter((task) => !task.hidden)); // hiddenなタスクは非表示
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

  // --- Fetch Unavailable Slots from Flask Backend ---
  const fetchUnavailableSlots = async () => {
    if (!currentUserId || !googleUserInfo) {
      setUserDefinedUnavailableSlots([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(
        `${FLASK_SERVER_URL}/unavailable-slots/${currentUserId}`
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "固定の予定リストの取得に失敗しました"
        );
      }
      const fetchedSlots = await response.json();
      setUserDefinedUnavailableSlots(fetchedSlots);
    } catch (error) {
      console.error("Error fetching unavailable slots:", error);
      setMessage({
        text: `固定の予定の取得中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
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

      if (response.status !== 204 && response.ok) {
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

  const handleRejectAndResuggest = async () => {
    if (!currentUserId || !aiDateSuggestion || !aiModelData) return; // aiModelData のチェックを追加

    setIsLoading(true);
    setMessage({
      text: "フィードバックを学習し、別の時間を探しています...",
      type: "info",
    });

    try {
      const newTaskForLearning = {
        id: "temp-" + Date.now(),
        title: newTaskTitle,
        estimatedTime: parseInt(newTaskEstimate),
        deadline: newTaskDeadline || null,
        completed: false,
        hidden: false,
      };

      const allUncompletedTasks = [
        ...tasks.filter((t) => !t.completed),
        newTaskForLearning,
      ];

      const existingPlacedTasks = tasks.filter((t) => t.start && !t.completed);

      const rejectResponse = await fetch(
        `${FLASK_SERVER_URL}/reject-suggestion`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: currentUserId,
            startTime: aiDateSuggestion.suggestedSlot.start.toISOString(),
            endTime: aiDateSuggestion.suggestedSlot.end.toISOString(),
            react_tasks: allUncompletedTasks,
            unavailableSlots: userDefinedUnavailableSlots,
            existingTasks: existingPlacedTasks,
            aiModelData: aiModelData, // 現在のAIモデルデータを送信
          }),
        }
      );

      if (!rejectResponse.ok) {
        const errorData = await rejectResponse.json();
        setMessage({
          text: `フィードバック学習中にエラー: ${errorData.error}`,
          type: "error",
        });
      } else {
        const updatedModel = await rejectResponse.json(); // 更新されたモデルデータを受け取る
        setAiModelData(updatedModel); // モデルデータを更新
        await saveAiModelToFirestore(updatedModel, userProfileType); // Firestoreに保存
      }

      await requestAiSuggestion(); // 再提案を要求
    } catch (error) {
      console.error("Error rejecting and resuggesting:", error);
      setMessage({
        text: `再提案中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
      setIsLoading(false);
    }
  };

  // --- Task Management ---
  // requestAiSuggestion 関数を修正
  const requestAiSuggestion = async () => {
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
    if (!aiModelData) {
      // AIモデルデータがロードされているか確認
      setMessage({
        text: "AIモデルのロードを待っています。しばらくお待ちください。",
        type: "info",
      });
      return;
    }

    setIsLoading(true);
    try {
      // NGゾーン計算用: すでにカレンダーに配置済みのタスク
      const existingPlacedTasks = tasks.filter((t) => t.start && !t.completed);

      // Qテーブル評価用: 未完了かつ未スケジュールのタスク
      const uncompletedAndUnscheduledTasks = tasks.filter(
        (t) => !t.completed && !t.start
      );

      const response = await fetch(`${FLASK_SERVER_URL}/suggest-slot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUserId,
          // 提案してほしい新規タスク
          task: {
            id: "temp-" + Date.now(),
            title: newTaskTitle,
            estimatedTime: parseInt(newTaskEstimate),
            deadline: newTaskDeadline || null,
          },
          // AIが考慮するべき他の情報
          unavailableSlots: userDefinedUnavailableSlots,
          existingTasks: existingPlacedTasks, // NGゾーン用
          uncompletedTasks: uncompletedAndUnscheduledTasks, // Qテーブル評価用
          aiModelData: aiModelData, // 現在のAIモデルデータを送信
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "AI提案の取得に失敗しました");
      }

      const suggestionResponse = await response.json();
      setAiDateSuggestion({
        title: newTaskTitle,
        estimatedTime: newTaskEstimate,
        suggestedSlot: {
          start: new Date(suggestionResponse.start),
          end: new Date(suggestionResponse.end),
        },
      });
      // AIモデルデータが返された場合は更新
      if (suggestionResponse.aiModelData) {
        setAiModelData(suggestionResponse.aiModelData);
        await saveAiModelToFirestore(
          suggestionResponse.aiModelData,
          userProfileType
        ); // Firestoreに保存
      }
      setMessage({ text: "AIが最適な日時を提案しました！", type: "info" });
    } catch (error) {
      console.error("Error requesting AI suggestion:", error);
      setMessage({
        text: `AI提案中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
      // 提案が失敗したら、AI提案の表示をクリアする
      setAiDateSuggestion(null);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmAndAddTask = async () => {
    if (
      !googleUserInfo ||
      !currentUserId ||
      !aiDateSuggestion ||
      !aiModelData
    ) {
      // aiModelData のチェックを追加
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
          title,
          suggestedSlot.start,
          suggestedSlot.end,
          eventDescription
        );
        if (addEventResult.success) {
          googleEventId = addEventResult.eventId;
        } else {
          console.warn("Failed to add event to Google Calendar.");
        }
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
        throw new Error(errorData.error || "タスクの追加に失敗しました");
      }

      setMessage({ text: `課題「${title}」を追加しました！`, type: "success" });

      fetchTasks();

      // AI提案確定後、入力フィールドをクリアし、AI提案表示をリセットして課題追加画面に戻る
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskDeadline("");
      setAiDateSuggestion(null);
    } catch (error) {
      console.error("Error confirming and adding task:", error);
      setMessage({
        text: `課題の追加中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTaskSubmit = async () => {
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
    if (!aiModelData) {
      // AIモデルデータがロードされているか確認
      setMessage({
        text: "AIモデルのロードを待っています。しばらくお待ちください。",
        type: "info",
      });
      return;
    }

    // AI提案モード
    if (googleAccessToken && newTaskEstimate.trim()) {
      requestAiSuggestion();
    } else {
      // 手動追加モード（見積もり時間がない場合など）
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
          googleEventId: null,
        };

        const response = await fetch(`${FLASK_SERVER_URL}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUserId,
            task: taskData,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "課題の追加に失敗しました");
        }
        setMessage({
          text: `課題「${newTaskTitle}」を追加しました！`,
          type: "success",
        });

        fetchTasks();
        setNewTaskTitle("");
        setNewTaskEstimate("");
        setNewTaskDeadline("");
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

  // 新しく追加: 期限切れタスクをスキップする関数
  const handleSkipTask = async (taskId) => {
    if (!googleUserInfo || !currentUserId || !aiModelData) return; // aiModelData のチェックを追加

    const taskToSkip = tasks.find((task) => task.id === taskId);
    if (!taskToSkip) return;

    setIsLoading(true);
    try {
      // 期限切れで、かつスケジュールされたタスクのみ、AIに負のフィードバックを送信
      // スケジュールされていないタスクのスキップはAI学習に影響させない
      if (taskToSkip.start && taskToSkip.end) {
        const skipResponse = await fetch(`${FLASK_SERVER_URL}/skip-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUserId,
            taskId: taskId, // AI側での参照用
            startTime: taskToSkip.start,
            endTime: taskToSkip.end,
            aiModelData: aiModelData, // 現在のAIモデルデータを送信
          }),
        });

        if (!skipResponse.ok) {
          const errorData = await skipResponse.json();
          setMessage({
            text: `スキップフィードバックの送信中にエラー: ${errorData.error}`,
            type: "error",
          });
        } else {
          const updatedModel = await skipResponse.json(); // 更新されたモデルデータを受け取る
          setAiModelData(updatedModel); // モデルデータを更新
          await saveAiModelToFirestore(updatedModel, userProfileType); // Firestoreに保存
          setMessage({
            text: "課題をスキップしました（AIが学習します）。",
            type: "info",
          });
        }
      } else {
        setMessage({ text: "課題をスキップしました。", type: "info" });
      }

      // 課題の状態を更新して非表示にする
      const updateTaskResponse = await fetch(
        `${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            completed: true, // 完了済みとしてマーク
            completedAt: new Date().toISOString(), // 現在時刻を完了時刻とする
            concentrationLevel: 0, // スキップなので集中度は0（またはnull）
            hidden: true, // リストから非表示
            rescheduled: false, // 再入力フラグをリセット
            // googleEventIdはそのまま
          }),
        }
      );
      if (!updateTaskResponse.ok) {
        const errorData = await updateTaskResponse.json();
        throw new Error(errorData.error || "タスク状態の更新に失敗");
      }

      // Googleカレンダーイベントがあれば削除（AIが登録したイベントなので）
      if (taskToSkip.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToSkip.googleEventId);
      }

      fetchTasks(); // リストを再取得してUIを更新
    } catch (error) {
      console.error("Error skipping task:", error);
      setMessage({
        text: `課題のスキップ中にエラーが発生しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTaskCompletion = async (taskId, currentStatus) => {
    if (!googleUserInfo || !currentUserId) return;

    const taskToUpdate = tasks.find((task) => task.id === taskId);
    if (!taskToUpdate) return;

    if (!currentStatus) {
      // 未完了 -> 完了にする場合はフィードバックモーダルを表示
      setShowCompletionFeedbackModalForTask(taskToUpdate);
    } else {
      // 完了状態 -> 未完了に戻す場合
      setIsLoading(true);
      try {
        // Google Event IDがあれば削除を試みる (期限内のタスクのみ)
        if (taskToUpdate.googleEventId && taskToUpdate.start) {
          await deleteEventFromGoogleCalendar(taskToUpdate.googleEventId);
        }
        const response = await fetch(
          `${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              completed: false,
              completedAt: null,
              concentrationLevel: null,
              hidden: false, // 未完了に戻したら再表示
              googleEventId:
                taskToUpdate.start && taskToUpdate.googleEventId
                  ? taskToUpdate.googleEventId
                  : null,
              rescheduled: false,
            }),
          }
        );
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "タスク状態の更新に失敗しました");
        }
        setMessage({ text: "課題を未完了に戻しました。", type: "info" });
        fetchTasks();
      } catch (error) {
        console.error("Error reverting task completion:", error);
        setMessage({
          text: "課題の完了状態の切り替え中にエラーが発生しました。",
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
    if (!googleUserInfo || !currentUserId || !aiModelData) {
      // aiModelData のチェックを追加
      setShowCompletionFeedbackModalForTask(null);
      return;
    }

    setIsLoading(true);
    try {
      const taskToComplete = tasks.find((task) => task.id === taskId);
      if (!taskToComplete) {
        throw new Error("完了対象のタスクが見つかりませんでした。");
      }

      // 期限切れのタスクかどうかを判定
      const isOverdue =
        taskToComplete.end && new Date() > new Date(taskToComplete.end);

      // AI学習フィードバック送信の条件
      // 期限内のスケジュール済みタスクの場合のみAI学習フィードバックを送信
      if (!isOverdue && taskToComplete.start && taskToComplete.end) {
        const tasksForLearning = tasks.map((task) =>
          task.id === taskId ? { ...task, completed: true, hidden: true } : task
        );

        const existingPlacedTasks = tasks.filter(
          (t) => t.id !== taskId && t.start && !t.completed
        );

        const feedbackResponse = await fetch(`${FLASK_SERVER_URL}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUserId,
            startTime: taskToComplete.start,
            endTime: taskToComplete.end,
            concentrationRating: concentration,
            react_tasks: tasksForLearning,
            unavailableSlots: userDefinedUnavailableSlots,
            existingTasks: existingPlacedTasks,
            aiModelData: aiModelData, // 現在のAIモデルデータを送信
          }),
        });

        if (!feedbackResponse.ok) {
          const errorData = await feedbackResponse.json();
          setMessage({
            text: `AIの学習中にエラー: ${errorData.error}`,
            type: "error",
          });
        } else {
          const updatedModel = await feedbackResponse.json(); // 更新されたモデルデータを受け取る
          setAiModelData(updatedModel); // モデルデータを更新
          await saveAiModelToFirestore(updatedModel, userProfileType); // Firestoreに保存
          setMessage({
            text: "素晴らしい！フィードバックをAIが学習します。",
            type: "success",
          });
        }
      } else {
        // 期限切れまたはスケジュールされていないタスクの場合は学習をスキップ
        setMessage({
          text: isOverdue
            ? "期限切れ課題を完了しました。"
            : "課題を完了しました（学習はスキップされました）。",
          type: "info",
        });
      }

      // タスクの完了状態を更新
      const updateTaskResponse = await fetch(
        `${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            completed: true,
            completedAt: completionTime.toISOString(),
            concentrationLevel: concentration,
            hidden: true, // 完了したら非表示
          }),
        }
      );
      if (!updateTaskResponse.ok) {
        const errorData = await updateTaskResponse.json();
        throw new Error(errorData.error || "タスク状態の更新に失敗");
      }

      // Googleカレンダーイベントがあれば削除 (期限内のタスクのみ)
      if (taskToComplete.googleEventId && !isOverdue) {
        await deleteEventFromGoogleCalendar(taskToComplete.googleEventId);
      }

      fetchTasks();
    } catch (error) {
      console.error("Error saving concentrated completion:", error);
      setMessage({
        text: `課題の完了情報の保存に失敗しました: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsLoading(false);
      setShowCompletionFeedbackModalForTask(null);
    }
  };

  const deleteTask = async (taskId) => {
    if (!googleUserInfo || !currentUserId) return;
    setIsLoading(true);
    try {
      const taskToDelete = tasks.find((task) => task.id === taskId);
      // Googleカレンダーイベントがあれば削除 (期限内のタスクのみ)
      const isOverdue =
        taskToDelete.end && new Date() > new Date(taskToDelete.end);
      if (taskToDelete && taskToDelete.googleEventId && !isOverdue) {
        // 期限内のタスクのみGoogleカレンダーから削除
        await deleteEventFromGoogleCalendar(taskToDelete.googleEventId);
      }
      const response = await fetch(
        `${FLASK_SERVER_URL}/tasks/${currentUserId}/${taskId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "タスクの削除に失敗");
      }
      setMessage({ text: "課題を削除しました。", type: "info" });
      fetchTasks();
    } catch (error) {
      console.error("Error deleting task:", error); // エラーログを追加
      setMessage({ text: "課題の削除中にエラー。", type: "error" });
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
    if (!googleUserInfo || !currentUserId) return;
    if (selectedUnavailableDays.length === 0) {
      setMessage({ text: "曜日を1つ以上選択。", type: "error" });
      return;
    }
    if (!newUnavailableStartTime || !newUnavailableEndTime) {
      setMessage({ text: "開始・終了時間を入力。", type: "error" });
      return;
    }
    if (newUnavailableStartTime >= newUnavailableEndTime) {
      setMessage({ text: "開始時間は終了時間より前に。", type: "error" });
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
            .join(", ")}`,
        createdAt: new Date().toISOString(),
      };
      const response = await fetch(`${FLASK_SERVER_URL}/unavailable-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId, slot: slotData }),
      });
      if (!response.ok) {
        // エラーレスポンスも考慮
        const errorData = await response.json();
        throw new Error(errorData.error || "固定予定の追加に失敗");
      }
      setMessage({ text: `固定の予定を追加しました！`, type: "success" });
      fetchUnavailableSlots();
      setSelectedUnavailableDays([]);
      setNewUnavailableLabel("");
    } catch (error) {
      console.error("Error adding unavailable slot:", error); // エラーログを追加
      setMessage({
        text: `固定予定の追加に失敗: ${error.message}`,
        type: "error",
      }); // 詳細なエラーメッセージ
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUnavailableSlot = async (slotId) => {
    if (!googleUserInfo || !currentUserId) return;
    setIsLoading(true);
    try {
      const response = await fetch(
        `${FLASK_SERVER_URL}/unavailable-slots/${currentUserId}/${slotId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        // エラーレスポンスも考慮
        const errorData = await response.json();
        throw new Error(errorData.error || "固定予定の削除に失敗");
      }
      setMessage({ text: "固定の予定を削除しました。", type: "info" });
      fetchUnavailableSlots();
    } catch (error) {
      console.error("Error deleting unavailable slot:", error); // エラーログを追加
      setMessage({
        text: `固定予定の削除に失敗: ${error.message}`,
        type: "error",
      }); // 詳細なエラーメッセージ
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Rendering ---
  const getTaskCardBgColor = (task) => {
    if (task.completed) return "bg-green-100 border-green-500";
    const now = new Date();
    // 期限切れで未完了のタスクは灰色
    if (task.end && now > new Date(task.end) && !task.completed) {
      return "bg-gray-200 border-gray-400";
    }
    // rescheduled のタスクに関する色分けは維持 (再入力項目はUIから削除されてもフラグは残るため)
    if (task.rescheduled && !task.start) {
      return "bg-blue-100 border-blue-500 animate-pulse";
    }
    if (task.start) {
      const diffHours = (new Date(task.start) - now) / 36e5;
      if (diffHours < 24) return "bg-red-100 border-red-500";
      if (diffHours < 72) return "bg-yellow-100 border-yellow-500";
    }
    return "bg-indigo-50 border-indigo-300";
  };

  const visibleTasks = googleUserInfo
    ? tasks.filter((task) => !task.hidden)
    : [];
  const displayUnavailableSlots = googleUserInfo
    ? userDefinedUnavailableSlots
    : [];

  // 認証とAIモデルのロードが完了するまでローディング表示
  if (
    !isAuthReady ||
    (currentUserId && !aiModelData && !showProfileTypeSelection)
  ) {
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
        {/* プロファイルタイプ選択モーダル */}
        {showProfileTypeSelection && (
          <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-5 transform animate-fade-in-down">
              <h2 className="text-2xl font-bold text-center text-indigo-700">
                あなたのタイプを選択してください
              </h2>
              <p className="text-center text-gray-600">
                AIがよりパーソナライズされた提案をするために、あなたの生活リズムに近いタイプを選んでください。
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => handleProfileTypeSelection("morning")}
                  className="flex-1 flex flex-col items-center justify-center p-4 bg-blue-100 text-blue-800 rounded-lg shadow-md hover:bg-blue-200 transition transform hover:scale-105"
                >
                  <Sun className="h-10 w-10 mb-2 text-blue-600" />
                  <span className="font-semibold text-lg">朝型人間</span>
                  <span className="text-sm text-blue-700 text-center mt-1">
                    午前中に集中しやすい
                  </span>
                </button>
                <button
                  onClick={() => handleProfileTypeSelection("night")}
                  className="flex-1 flex flex-col items-center justify-center p-4 bg-purple-100 text-purple-800 rounded-lg shadow-md hover:bg-purple-200 transition transform hover:scale-105"
                >
                  <Moon className="h-10 w-10 mb-2 text-purple-600" />
                  <span className="font-semibold text-lg">夜型人間</span>
                  <span className="text-sm text-purple-700 text-center mt-1">
                    午後に集中しやすい
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
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
        {/* AIモデルがロードされていない、またはタイプが選択されていない場合は、課題追加セクションなどを非表示にする */}
        {aiModelData && (
          <>
            <CollapsibleSection
              title={"新しい課題を追加"}
              icon={<Plus className="h-6 w-6 text-indigo-500" />}
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
                      希望の期限
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
                    disabled={isLoading}
                    className="flex-1 flex items-center justify-center px-5 py-2.5 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 transition transform hover:scale-105 disabled:opacity-50"
                  >
                    <Sparkles className="mr-2 h-5 w-5" />{" "}
                    AIが日時を入れて課題追加{" "}
                  </button>
                </div>
              )}
            </CollapsibleSection>

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
                      <label
                        key={key}
                        className="flex items-center cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          value={key}
                          checked={selectedUnavailableDays.includes(key)}
                          onChange={handleDayChange}
                          className="form-checkbox h-4 w-4 text-purple-600 rounded focus:ring-purple-500"
                        />
                        <span className="ml-1 text-sm text-gray-700">
                          {value}
                        </span>
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
                      onChange={(e) =>
                        setNewUnavailableStartTime(e.target.value)
                      }
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
                  {visibleTasks.map((task) => {
                    // 期限切れかどうかを判定 (現在時刻を考慮)
                    const now = new Date();
                    const isOverdue =
                      task.end && now > new Date(task.end) && !task.completed;

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
                              )}{" "}
                            </h3>
                            <div className="flex flex-wrap items-center text-xs text-gray-600 mt-0.5 gap-x-2">
                              {task.estimatedTime > 0 && !task.completed && (
                                <span className="flex items-center">
                                  <Clock className="h-3.5 w-3.5 mr-0.5" />{" "}
                                  {task.estimatedTime} 分
                                </span>
                              )}
                              {task.start && !task.completed && (
                                <span
                                  className={`flex items-center font-semibold`}
                                >
                                  <Calendar className="h-3.5 w-3.5 mr-0.5" />{" "}
                                  提案日時:{" "}
                                  {new Date(task.start).toLocaleString(
                                    "ja-JP",
                                    {
                                      month: "long",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      timeZone: "Asia/Tokyo",
                                    }
                                  )}
                                </span>
                              )}
                              {task.rescheduled && !task.start && (
                                <span className="text-blue-600 font-semibold">
                                  再入力待ち
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-1.5 ml-2">
                            {!task.completed ? ( // 未完了の場合のみボタンを表示
                              <>
                                {isOverdue && task.start ? ( // 期限切れかつスケジュールされたタスクの場合のみスキップボタン
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
                                    toggleTaskCompletion(
                                      task.id,
                                      task.completed
                                    )
                                  }
                                  className={`p-1.5 rounded-full transition shadow-sm ${
                                    isOverdue
                                      ? "bg-purple-500 hover:bg-purple-600"
                                      : "bg-green-500 hover:bg-green-600" // 期限切れは紫色、期限内は緑色
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
                              // 完了済みの場合は未完了に戻すボタンのみ
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

            <CollapsibleSection
              title="あなたの活動記録"
              icon={<BarChart className="h-6 w-6 text-blue-500" />}
              isOpen={showStats}
              setIsOpen={setShowStats}
            >
              <div className="space-y-4 p-2">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="sm:text-sm font-medium text-gray-700">
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
                    <span className="sm:text-sm font-medium text-gray-700">
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
                        width: `${Math.min(
                          100,
                          (taskStats.month / 20) * 100
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </CollapsibleSection>
          </>
        )}{" "}
        {/* End of conditional rendering for main content */}
        <footer className="text-center text-gray-500 text-xs pt-6 border-t border-gray-200">
          <p>&copy; 2024 AI課題プランナー</p>
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
        @keyframes fade-in-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }\n        .animate-fade-in-down { animation: fade-in-down 0.4s ease-out forwards; }\n        @keyframes pulse { 50% { opacity: .7; } }\n        .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }\n      `}</style>
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
