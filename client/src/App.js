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
} from "firebase/firestore";

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
  const [concentrationRating, setConcentrationRating] = useState(0); // Set default to 5
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
  const [db, setDb] = useState(null);
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
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestore);
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

  // --- Firestore Data Listener (Tasks) & Stats Calculation ---
  useEffect(() => {
    // Load tasks from Firestore only when logged in with Google
    if (!db || !currentUserId || !isAuthReady || !googleUserInfo) {
      console.log(
        "Firestore tasks listener not ready (or not Google logged in). Clearing tasks.",
        { db, currentUserId, isAuthReady, googleUserInfo }
      );
      setTasks([]); // Clear tasks if not logged in with Google
      return;
    }

    const tasksCollectionPath = `artifacts/${appId}/users/${currentUserId}/tasks`;
    const tasksCollectionRef = collection(db, tasksCollectionPath);
    const q = query(tasksCollectionRef);

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        let fetchedTasks = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Sort tasks: uncompleted first, then by closest deadline, then by oldest creation date
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

        setTasks(fetchedTasks);

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000
        );
        const completedLast7Days = fetchedTasks.filter(
          (t) =>
            t.completed &&
            t.completedAt &&
            new Date(t.completedAt) >= sevenDaysAgo
        ).length;
        const completedLast30Days = fetchedTasks.filter(
          (t) =>
            t.completed &&
            t.completedAt &&
            new Date(t.completedAt) >= thirtyDaysAgo
        ).length;
        setTaskStats({ week: completedLast7Days, month: completedLast30Days });
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
  }, [db, currentUserId, isAuthReady, appId, googleUserInfo]); // Add googleUserInfo to dependency array

  // --- Firestore Data Listener (Unavailable Slots) ---
  useEffect(() => {
    // Load fixed unavailability slots from Firestore only when logged in with Google
    if (!db || !currentUserId || !isAuthReady || !googleUserInfo) {
      console.log(
        "Firestore unavailable slots listener not ready (or not Google logged in). Clearing slots.",
        { db, currentUserId, isAuthReady, googleUserInfo }
      );
      setUserDefinedUnavailableSlots([]); // Clear fixed unavailability slots if not logged in with Google
      return;
    }

    const unavailableSlotsCollectionPath = `artifacts/${appId}/users/${currentUserId}/unavailable_slots`;
    const unavailableSlotsCollectionRef = collection(
      db,
      unavailableSlotsCollectionPath
    );
    const q = query(unavailableSlotsCollectionRef);

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const fetchedSlots = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setUserDefinedUnavailableSlots(fetchedSlots);
      },
      (error) => {
        console.error("Error fetching unavailable slots:", error);
        setMessage({
          text: "固定の予定の取得中にエラーが発生しました。",
          type: "error",
        });
      }
    );
    return () => unsubscribe();
  }, [db, currentUserId, isAuthReady, appId, googleUserInfo]); // Add googleUserInfo to dependency array

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

  // --- Helper function to generate recurring unavailability slots ---
  const generateRecurringSlots = (
    unavailableSlots,
    searchStartDate,
    searchEndDate
  ) => {
    const generatedSlots = [];
    // Ensure searchStartDate is at the beginning of its day for consistent iteration
    const startOfDaySearch = new Date(searchStartDate);
    startOfDaySearch.setHours(0, 0, 0, 0);

    // Iterate through days within the search range
    for (
      let d = new Date(startOfDaySearch);
      d.getTime() <= searchEndDate.getTime();
      d.setDate(d.getDate() + 1)
    ) {
      const currentDayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday

      unavailableSlots.forEach((slot) => {
        // slot.dayOfWeek is now an array, so use includes
        // Check if slot.dayOfWeek exists and if the current day of the week is included
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

          // Handle overnight slots (e.g., 23:00 to 07:00 next day)
          if (slotEnd.getTime() <= slotStart.getTime()) {
            slotEnd.setDate(slotEnd.getDate() + 1);
          }

          // Only add if the slot overlaps with or is within the search range
          // and the start time is not in the past relative to the current search start.
          if (slotEnd > searchStartDate && slotStart < searchEndDate) {
            generatedSlots.push({
              start: slotStart,
              end: slotEnd,
              summary: slot.label || "固定の予定",
              isUserDefined: true, // Custom flag to identify user-defined slots
            });
          }
        }
      });
    }
    return generatedSlots;
  };

  // --- AI Scheduling Logic ---
  const findAvailableTimeSlot = (
    durationMinutes,
    userDeadlineStr,
    searchAfterDate = null
  ) => {
    const now = new Date();
    // The search end date will be the user's desired deadline, or 30 days from now, whichever is earlier.
    const searchUntil = userDeadlineStr
      ? new Date(userDeadlineStr)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    // If the deadline is before the current time, there are no available slots.
    if (searchUntil < now) return null;

    const slotMs = durationMinutes * 60 * 1000;
    // Adjust search start time (if searchAfterDate exists, then after that, otherwise current time or 7 AM today, whichever is later)
    let searchStart = searchAfterDate
      ? new Date(searchAfterDate.getTime() + 60000)
      : new Date(Math.max(now.getTime(), new Date(now).setHours(7, 0, 0, 0)));
    // Adjust searchStart so it does not exceed searchUntil
    if (searchStart >= searchUntil) return null;

    // Generate specific time slots for user-defined fixed unavailability within the search range
    const userGeneratedBusySlots = generateRecurringSlots(
      userDefinedUnavailableSlots,
      searchStart,
      searchUntil
    );

    // Combine Google Calendar events and user-defined fixed unavailability
    // Filter out all-day Google Calendar events (those with event.start.date but no event.start.dateTime)
    const allBusyPeriods = [
      ...googleEvents
        .filter((event) => event.start.dateTime) // Only target events with dateTime (exclude all-day events)
        .map((event) => ({
          start: new Date(event.start.dateTime),
          end: new Date(event.end.dateTime),
        })),
      ...userGeneratedBusySlots.map((slot) => ({
        start: slot.start,
        end: slot.end,
      })),
    ];

    // Sort all time slots by start time
    allBusyPeriods.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Merge overlapping time slots
    const mergedBusyPeriods = [];
    if (allBusyPeriods.length > 0) {
      let currentMerged = { ...allBusyPeriods[0] };
      for (let i = 1; i < allBusyPeriods.length; i++) {
        const nextPeriod = allBusyPeriods[i];
        // If the next period overlaps or touches the current merged period
        if (nextPeriod.start.getTime() <= currentMerged.end.getTime()) {
          currentMerged.end = new Date(
            Math.max(currentMerged.end.getTime(), nextPeriod.end.getTime())
          );
        } else {
          mergedBusyPeriods.push(currentMerged);
          currentMerged = { ...nextPeriod };
        }
      }
      mergedBusyPeriods.push(currentMerged);
    }

    // Current starting point for finding available time slots
    let lastAvailableTime = searchStart;

    for (const period of mergedBusyPeriods) {
      // If the start of the current busy period is after our last available time
      // Check if there's enough free time in between
      if (period.start.getTime() > lastAvailableTime.getTime()) {
        if (period.start.getTime() - lastAvailableTime.getTime() >= slotMs) {
          const potentialEnd = new Date(lastAvailableTime.getTime() + slotMs);
          // Make sure the proposed slot does not exceed the search end date
          if (potentialEnd <= searchUntil) {
            return { start: lastAvailableTime, end: potentialEnd };
          }
        }
      }
      // Update lastAvailableTime to the end time of the current busy period
      // (or keep it if the existing lastAvailableTime is later)
      lastAvailableTime = new Date(
        Math.max(lastAvailableTime.getTime(), period.end.getTime())
      );
    }

    // After checking all busy periods, check if there's an available slot after the last busy period
    const finalPotentialEnd = new Date(lastAvailableTime.getTime() + slotMs);
    if (finalPotentialEnd <= searchUntil) {
      return { start: lastAvailableTime, end: finalPotentialEnd };
    }

    return null;
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
      return false;
    }

    setIsLoading(true);
    try {
      const event = {
        summary: title,
        description: description,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, // Get local timezone
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
      return { success: true, eventId: data.id }; // Return event ID
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

  // New function to delete an event from Google Calendar
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
        // A 204 No Content response is expected for successful deletion.
        // If it's not ok and not a 204, then it's an error.
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
  const requestAiSuggestion = async (searchAfter = null) => {
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "AI提案を利用するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    // Always fetch the latest Google Calendar events
    await fetchGoogleCalendarEvents(googleAccessToken);

    const suggestedSlot = findAvailableTimeSlot(
      parseInt(newTaskEstimate),
      newTaskDeadline,
      searchAfter
    );

    if (suggestedSlot) {
      setAiDateSuggestion({
        title: newTaskTitle,
        estimatedTime: newTaskEstimate,
        suggestedSlot,
      });
    } else {
      setMessage({
        text: "AIが空き時間を見つけられませんでした。手動で期限を設定するか、別の時間で再検索してください。",
        type: "info",
      });
    }
    setIsLoading(false);
  };

  const confirmAndAddTask = async () => {
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "課題を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId || !aiDateSuggestion) {
      setMessage({
        text: "Firestoreが利用できないか、AI提案が確定していません。",
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    const { title, estimatedTime, suggestedSlot } = aiDateSuggestion;
    // --- ここから修正 ---
    // ISO 8601形式の完全なタイムスタンプを期限として保存
    const finalDeadline = suggestedSlot.start.toISOString();
    // --- ここまで修正 ---

    try {
      const tasksCollectionRef = collection(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`
      );
      let googleEventId = null; // Initialize googleEventId

      // Add event to Google Calendar if successful, store the event ID
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
          // If adding to Google Calendar fails, decide whether to proceed with task creation.
          // For now, we'll proceed but log the warning.
          console.warn(
            "Failed to add event to Google Calendar, proceeding without event ID."
          );
        }
      }

      const taskData = {
        title,
        estimatedTime: parseInt(estimatedTime),
        deadline: finalDeadline, // 修正後の期限を保存
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null,
        concentrationLevel: null,
        hidden: false,
        googleEventId: googleEventId, // Store the Google Calendar event ID
      };
      await addDoc(tasksCollectionRef, taskData);
      setMessage({ text: `課題「${title}」を追加しました！`, type: "success" });

      // Reset form
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskDeadline("");
      setAiDateSuggestion(null);
      setEditingTask(null);
    } catch (error) {
      console.error("Error adding task with AI date:", error);
      setMessage({
        text: "課題の追加中にエラーが発生しました。",
        type: "error",
      });
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
    // If GoogleAccessToken is available and estimated time is provided, it's AI suggestion mode.
    // However, if AI suggestion is not needed, prompt for manual input.
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

      // Check for Firestore and user ID availability
      if (!db || !currentUserId) {
        setMessage({
          text: "データベースの準備ができていません。",
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
        
        // --- ここから修正 ---
        // 手動入力の場合も、日付の終わりに時刻を設定してISO文字列で保存
        const deadlineDate = new Date(newTaskDeadline);
        deadlineDate.setHours(23, 59, 59, 999);
        const finalDeadline = deadlineDate.toISOString();
        // --- ここまで修正 ---

        const taskData = {
          title: newTaskTitle,
          estimatedTime: parseInt(newTaskEstimate),
          deadline: finalDeadline, // 修正後の期限を保存
          completed: false,
          createdAt: new Date().toISOString(),
          completedAt: null,
          concentrationLevel: null,
          hidden: false,
          googleEventId: null, // Manually added tasks don't have a Google Event ID initially.
        };

        if (editingTask) {
          const taskDocRef = doc(
            db,
            `artifacts/${appId}/users/${currentUserId}/tasks`,
            editingTask.id
          );
          // 編集時もdeadlineをISO文字列に
          const editDeadlineDate = new Date(newTaskDeadline);
          editDeadlineDate.setHours(23, 59, 59, 999);
          await updateDoc(taskDocRef, {
            ...taskData,
            deadline: editDeadlineDate.toISOString(),
          });
          setMessage({
            text: `課題「${newTaskTitle}」を更新しました！`,
            type: "success",
          });
        } else {
          await addDoc(tasksCollectionRef, taskData);
          setMessage({
            text: `課題「${newTaskTitle}」を追加しました！`,
            type: "success",
          });
        }
        
        // Reset form
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
    // Google login required
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
    // deadlineがISO文字列なので、YYYY-MM-DD形式に変換して表示
    setNewTaskDeadline(task.deadline ? task.deadline.split("T")[0] : "");
    setShowTaskInput(true);
    if (taskInputRef.current) taskInputRef.current.focus();
  };

  // Function to toggle task completion status
  const toggleTaskCompletion = async (taskId, currentStatus) => {
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "課題の完了状態を更新するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
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
      // --- ここから修正 ---
      // 期限の比較をDateオブジェクト同士で行う
      const deadlineDate = taskToUpdate.deadline ? new Date(taskToUpdate.deadline) : null;
      // --- ここまで修正 ---

      // If a deadline is set and it's not past 
      if (deadlineDate && deadlineDate >= now) {
        // Display modal for concentration and completion time
        setShowCompletionFeedbackModalForTask(taskToUpdate);
        return; // Do not update Firestore here, update after input from modal
      } else if (taskToUpdate.googleEventId) {
        // If task is completed outside the deadline or no deadline, but has a Google Event ID, delete it.
        await deleteEventFromGoogleCalendar(taskToUpdate.googleEventId);
      }
    } else {
      // If changing from completed back to uncompleted, clear googleEventId in Firestore
      // We don't re-add to Google Calendar here, it needs to be rescheduled.
      setIsLoading(true);
      try {
        const taskDocRef = doc(
          db,
          `artifacts/${appId}/users/${currentUserId}/tasks`,
          taskId
        );
        await updateDoc(taskDocRef, {
          completed: false,
          completedAt: null,
          concentrationLevel: null,
          hidden: false,
          googleEventId: null, // Clear the Google event ID when reverting to uncompleted
        });
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

    // For expired tasks or tasks without deadline, directly update completion without concentration input
    setIsLoading(true);
    try {
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      await updateDoc(taskDocRef, {
        completed: true,
        completedAt: new Date().toISOString(), // Record current time
        // concentrationLevel remains null, hidden remains false
        // These are set via the modal
      });
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

  // Function to finalize task completion after entering concentration and completion time
  const handleConfirmCompletion = async (
    taskId,
    concentration,
    completionTime
  ) => {
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "課題の完了情報を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      setShowCompletionFeedbackModalForTask(null);
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
        type: "error",
      });
      setShowCompletionFeedbackModalForTask(null);
      return;
    }

    setIsLoading(true);
    try {
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      const taskToComplete = tasks.find((task) => task.id === taskId);

      // Update task in Firestore
      await updateDoc(taskDocRef, {
        completed: true,
        completedAt: completionTime.toISOString(), // Completion time entered in modal
        concentrationLevel: concentration,
        hidden: true, // Hide from list after completion
      });

      // If the task has a Google Calendar event ID, delete it
      if (taskToComplete && taskToComplete.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToComplete.googleEventId);
        // After successful deletion, clear the googleEventId from Firestore as well
        await updateDoc(taskDocRef, { googleEventId: null });
      }

      setMessage({
        text: "素晴らしい！集中して課題を終えましたね！報酬獲得！", // Reward message
        type: "success",
      });
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
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "課題を削除するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
        type: "error",
      });
      return;
    }
    try {
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      const taskToDelete = tasks.find((task) => task.id === taskId);

      // If the task has a Google Calendar event ID, delete it from Google Calendar first
      if (taskToDelete && taskToDelete.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToDelete.googleEventId);
      }

      await deleteDoc(taskDocRef);
      setMessage({ text: "課題を削除しました。", type: "info" });
    } catch (error) {
      console.error("Error deleting task:", error);
      setMessage({
        text: "課題の削除中にエラーが発生しました。",
        type: "error",
      });
    }
  };

  const saveConcentration = async (taskId, rating) => {
    // Google login required
    // This function is used when recording concentration after re-entering expired tasks,
    // so leave Google login check in case it's separated from toggleTaskCompletion.
    if (!googleUserInfo) {
      setMessage({
        text: "集中度を記録するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
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
    try {
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      await updateDoc(taskDocRef, { concentrationLevel: rating, hidden: true });
      setMessage({
        text: "集中度を記録しました！お疲れ様でした。",
        type: "success",
      });
    } catch (error) {
      console.error("Error saving concentration:", error);
      setMessage({ text: "集中度の保存に失敗しました。", type: "error" });
    }
  };

  const rescheduleTask = async (taskId) => {
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "課題を再入力するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
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
      const taskDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/tasks`,
        taskId
      );
      const taskToReschedule = tasks.find((task) => task.id === taskId);

      // If the task has a Google Calendar event ID, delete it before rescheduling
      if (taskToReschedule && taskToReschedule.googleEventId) {
        await deleteEventFromGoogleCalendar(taskToReschedule.googleEventId);
      }

      await updateDoc(taskDocRef, {
        estimatedTime: parseInt(additionalTime), // Overwrite existing estimated time
        deadline: null, // Reset deadline
        completed: false,
        rescheduled: true, // Reschedule flag
        googleEventId: null, // Clear Google Event ID after deletion
      });
      setMessage({ text: "課題を再入力しました。", type: "success" });
      setRescheduleInputs((prev) => ({ ...prev, [taskId]: "" })); // Clear input field
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
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "固定の予定を保存するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
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

    // More robust time validation
    const [startHour, startMinute] = newUnavailableStartTime
      .split(":")
      .map(Number);
    const [endHour, endMinute] = newUnavailableEndTime.split(":").map(Number);

    // Error if start time is after end time (unless it spans across days)
    // E.g., 10:00 -> 09:00 is an error.
    // E.g., 23:00 -> 07:00 is not an error as it spans across days (judged by endHour < startHour)
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
      const unavailableSlotsCollectionRef = collection(
        db,
        `artifacts/${appId}/users/${currentUserId}/unavailable_slots`
      );
      const slotData = {
        dayOfWeek: selectedUnavailableDays, // Save as an array
        startTime: newUnavailableStartTime, // "HH:MM"
        endTime: newUnavailableEndTime, // "HH:MM"
        label:
          newUnavailableLabel.trim() ||
          `毎週 ${selectedUnavailableDays
            .map((d) => DAY_OF_WEEK_MAP[parseInt(d)])
            .join(", ")} の固定予定`,
        createdAt: new Date().toISOString(),
      };
      await addDoc(unavailableSlotsCollectionRef, slotData);
      setMessage({
        text: `固定の予定「${slotData.label}」を追加しました！`,
        type: "success",
      });
      setSelectedUnavailableDays([]);
      setNewUnavailableStartTime("09:00");
      setNewUnavailableEndTime("17:00");
      setNewUnavailableLabel("");
    } catch (error) {
      console.error("Firebase Error adding unavailable slot:", error);
      setMessage({
        text: `固定の予定の追加中にエラーが発生しました: ${error.message}`,
        type: "error",
      }); // Display error message from Firestore
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUnavailableSlot = async (slotId) => {
    // Google login required
    if (!googleUserInfo) {
      setMessage({
        text: "固定の予定を削除するにはGoogleログインが必要です。",
        type: "error",
      });
      return;
    }
    if (!db || !currentUserId) {
      setMessage({
        text: "データベースの準備ができていません。",
        type: "error",
      });
      return;
    }
    try {
      const slotDocRef = doc(
        db,
        `artifacts/${appId}/users/${currentUserId}/unavailable_slots`,
        slotId
      );
      await deleteDoc(slotDocRef);
      setMessage({ text: "固定の予定を削除しました。", type: "info" });
    } catch (error) {
      console.error("Error deleting unavailable slot:", error);
      setMessage({
        text: "固定の予定の削除中にエラーが発生しました。",
        type: "error",
      });
    }
  };

  // --- UI Rendering ---
  const getTaskCardBgColor = (task) => {
    if (task.completed) return "bg-green-100 border-green-500";
    if (task.deadline) {
      const today = new Date();
      // --- ここから修正 ---
      const deadlineDate = new Date(task.deadline); // deadlineはISO文字列なのでそのままDateオブジェクトに
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0); // 日付の比較のために時刻をリセット
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3);
      threeDaysFromNow.setHours(0, 0, 0, 0);

      if (deadlineDate < today) return "bg-red-100 border-red-500 animate-pulse-fast"; // 期限切れ
      
      const deadlineDayStart = new Date(deadlineDate);
      deadlineDayStart.setHours(0,0,0,0);
      
      if (deadlineDayStart <= tomorrow) return "bg-red-100 border-red-500"; // 明日までの期限
      if (deadlineDayStart <= threeDaysFromNow) return "bg-yellow-100 border-yellow-500"; // 3日以内の期限
      // --- ここまで修正 ---
    }
    if (task.rescheduled) return "bg-blue-100 border-blue-500"; // Rescheduled task
    return "bg-indigo-50 border-indigo-300"; // Default
  };

  // If not logged in with Google, clear visible tasks and fixed unavailability slots
  const visibleTasks = googleUserInfo
    ? tasks.filter((task) => !task.hidden)
    : [];
  const displayUnavailableSlots = googleUserInfo
    ? userDefinedUnavailableSlots
    : [];

  // Loading display when authentication is not ready yet
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
                  onClick={() =>
                    requestAiSuggestion(aiDateSuggestion.suggestedSlot.end)
                  }
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

                  {/* Display concentration input for overdue tasks */}
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
        @keyframes pulse-fast { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }
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

