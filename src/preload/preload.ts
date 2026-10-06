import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AresApi,
  type OperationResult,
  type SystemCapabilities,
  type SystemStatusData
} from "../shared/contracts";
import type {
  ActionHistoryListInput,
  ActionHistoryRecord,
  ActionLifecycleResult,
  ActionOperationResult,
  ActionOutcome,
  ActionSubmission
} from "../shared/action-contracts";
import type {
  CategoryListInput,
  CategoryRecord,
  CompleteTaskInput,
  CreateCategoryInput,
  CreateEventInput,
  CreateReminderInput,
  CreateTaskInput,
  CreateWeeklyScheduleInput,
  DeleteEventData,
  DeleteTaskData,
  DeleteTaskInput,
  DeleteWeeklyRoutineData,
  DeleteWeeklyRoutineInput,
  DeleteWeeklyScheduleData,
  DeleteWeeklyScheduleInput,
  TaskDeletionCancellationData,
  TaskDeletionConfirmationInput,
  TaskDeletionRequestData,
  DeleteEventInput,
  EventDeletionCancellationData,
  EventDeletionConfirmationInput,
  EventDeletionRequestData,
  EventListInput,
  EventRecord,
  GetTodayScheduleInput,
  GetWeekScheduleInput,
  PlannerListData,
  PlannerMutationData,
  PlannerOperationResult,
  ReminderListInput,
  ReminderRecord,
  TaskListInput,
  TaskRecord,
  TodayScheduleData,
  UpdateCategoryInput,
  UpdateEventInput,
  UpdateTaskInput,
  WeekScheduleData,
  CreateWeeklyRoutineInput,
  UpdateWeeklyRoutineInput,
  WeeklyRoutineListInput,
  WeeklyRoutineRecord,
  UpdateWeeklyScheduleInput,
  WeeklyScheduleListInput,
  WeeklyScheduleRecord
} from "../shared/planner-contracts";
import type {
  ApplicationListData,
  ApplicationListInput,
  ApplicationMutationData,
  ApplicationOperationResult,
  CatalogApplicationRegistrationData,
  CustomApplicationRegistrationData,
  RegisterCatalogApplicationInput,
  RegisterCustomApplicationInput,
  UpdateApplicationInput
} from "../shared/application-contracts";
import type {
  DashboardOperationResult,
  DashboardTodaySummary
} from "../shared/dashboard-contracts";
import type {
  AssistantInterpretRequest,
  AssistantInterpretation,
  AssistantOperationResult,
  AssistantContextData,
  AssistantContextSetInput
} from "../shared/assistant-contracts";
import type {
  VoiceOperationResult,
  VoiceTranscriptionData,
  VoiceTranscriptionInput
} from "../shared/voice-contracts";
import type {
  SettingsOperationResult,
  UpdateVoicePreferencesInput,
  VoicePreferencesData
} from "../shared/settings-contracts";
import type {
  CompleteHabitInput,
  CreateHabitInput,
  HabitCompletionRecord,
  HabitDailyProgressData,
  HabitDailyProgressInput,
  HabitListData,
  HabitListInput,
  HabitMutationData,
  HabitOperationResult,
  HabitRecord,
  HabitWeeklyProgressData,
  HabitWeeklyProgressInput,
  UpdateHabitInput
} from "../shared/habit-contracts";

const aresApi = {
  system: {
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.system.getStatus) as Promise<
        OperationResult<SystemStatusData>
      >,
    getCapabilities: () =>
      ipcRenderer.invoke(IPC_CHANNELS.system.getCapabilities) as Promise<
        OperationResult<SystemCapabilities>
      >
  },
  dashboard: {
    getTodaySummary: () =>
      ipcRenderer.invoke(IPC_CHANNELS.dashboard.getTodaySummary) as Promise<
        DashboardOperationResult<DashboardTodaySummary>
      >
  },
  planner: {
    categories: {
      create: (input: CreateCategoryInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.categories.create, input) as Promise<
          PlannerOperationResult<PlannerMutationData<CategoryRecord>>
        >,
      list: (input: CategoryListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.categories.list, input) as Promise<
          PlannerOperationResult<PlannerListData<CategoryRecord>>
        >,
      update: (input: UpdateCategoryInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.categories.update, input) as Promise<
          PlannerOperationResult<PlannerMutationData<CategoryRecord>>
        >
    },
    tasks: {
      create: (input: CreateTaskInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.create, input) as Promise<
          PlannerOperationResult<PlannerMutationData<TaskRecord>>
        >,
      list: (input: TaskListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.list, input) as Promise<
          PlannerOperationResult<PlannerListData<TaskRecord>>
        >,
      update: (input: UpdateTaskInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.update, input) as Promise<
          PlannerOperationResult<PlannerMutationData<TaskRecord>>
        >,
      complete: (input: CompleteTaskInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.complete, input) as Promise<
          PlannerOperationResult<PlannerMutationData<TaskRecord>>
        >,
      requestDeletion: (input: DeleteTaskInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.requestDeletion, input) as Promise<PlannerOperationResult<TaskDeletionRequestData>>,
      confirmDeletion: (input: TaskDeletionConfirmationInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.confirmDeletion, input) as Promise<PlannerOperationResult<DeleteTaskData>>,
      cancelDeletion: (input: TaskDeletionConfirmationInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.tasks.cancelDeletion, input) as Promise<PlannerOperationResult<TaskDeletionCancellationData>>
    },
    events: {
      create: (input: CreateEventInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.events.create, input) as Promise<
          PlannerOperationResult<PlannerMutationData<EventRecord>>
        >,
      list: (input: EventListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.events.list, input) as Promise<
          PlannerOperationResult<PlannerListData<EventRecord>>
        >,
      update: (input: UpdateEventInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.events.update, input) as Promise<
          PlannerOperationResult<PlannerMutationData<EventRecord>>
        >,
      requestDeletion: (input: DeleteEventInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.events.requestDeletion, input) as Promise<
          PlannerOperationResult<EventDeletionRequestData>
        >,
      confirmDeletion: (input: EventDeletionConfirmationInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.events.confirmDeletion, input) as Promise<
          PlannerOperationResult<DeleteEventData>
        >,
      cancelDeletion: (input: EventDeletionConfirmationInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.events.cancelDeletion, input) as Promise<
          PlannerOperationResult<EventDeletionCancellationData>
        >
    },
    reminders: {
      create: (input: CreateReminderInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.reminders.create, input) as Promise<
          PlannerOperationResult<PlannerMutationData<ReminderRecord>>
        >,
      list: (input: ReminderListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.reminders.list, input) as Promise<
          PlannerOperationResult<PlannerListData<ReminderRecord>>
        >
    },
    weeklyRoutines: {
      create: (input: CreateWeeklyRoutineInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklyRoutines.create, input) as Promise<
          PlannerOperationResult<PlannerMutationData<WeeklyRoutineRecord>>
        >,
      list: (input: WeeklyRoutineListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklyRoutines.list, input) as Promise<
          PlannerOperationResult<PlannerListData<WeeklyRoutineRecord>>
        >,
      update: (input: UpdateWeeklyRoutineInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklyRoutines.update, input) as Promise<
          PlannerOperationResult<PlannerMutationData<WeeklyRoutineRecord>>
        >,
      delete: (input: DeleteWeeklyRoutineInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklyRoutines.delete, input) as Promise<
          PlannerOperationResult<DeleteWeeklyRoutineData>
        >
    },
    weeklySchedules: {
      create: (input: CreateWeeklyScheduleInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklySchedules.create, input) as Promise<
          PlannerOperationResult<PlannerMutationData<WeeklyScheduleRecord>>
        >,
      list: (input: WeeklyScheduleListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklySchedules.list, input) as Promise<
          PlannerOperationResult<PlannerListData<WeeklyScheduleRecord>>
        >,
      update: (input: UpdateWeeklyScheduleInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklySchedules.update, input) as Promise<
          PlannerOperationResult<PlannerMutationData<WeeklyScheduleRecord>>
        >,
      delete: (input: DeleteWeeklyScheduleInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.weeklySchedules.delete, input) as Promise<
          PlannerOperationResult<DeleteWeeklyScheduleData>
        >
    },
    schedule: {
      getToday: (input: GetTodayScheduleInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.schedule.getToday, input) as Promise<
          PlannerOperationResult<TodayScheduleData>
        >,
      getWeek: (input: GetWeekScheduleInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.planner.schedule.getWeek, input) as Promise<
          PlannerOperationResult<WeekScheduleData>
        >
    }
  },
  habits: {
    create: (input: CreateHabitInput) => ipcRenderer.invoke(IPC_CHANNELS.habits.create, input) as Promise<HabitOperationResult<HabitMutationData<HabitRecord>>>,
    list: (input: HabitListInput) => ipcRenderer.invoke(IPC_CHANNELS.habits.list, input) as Promise<HabitOperationResult<HabitListData<HabitRecord>>>,
    update: (input: UpdateHabitInput) => ipcRenderer.invoke(IPC_CHANNELS.habits.update, input) as Promise<HabitOperationResult<HabitMutationData<HabitRecord>>>,
    complete: (input: CompleteHabitInput) => ipcRenderer.invoke(IPC_CHANNELS.habits.complete, input) as Promise<HabitOperationResult<HabitMutationData<HabitCompletionRecord>>>,
    getDailyProgress: (input: HabitDailyProgressInput) => ipcRenderer.invoke(IPC_CHANNELS.habits.getDailyProgress, input) as Promise<HabitOperationResult<HabitDailyProgressData>>,
    getWeeklyProgress: (input: HabitWeeklyProgressInput) => ipcRenderer.invoke(IPC_CHANNELS.habits.getWeeklyProgress, input) as Promise<HabitOperationResult<HabitWeeklyProgressData>>
  },
  actions: {
    propose: (submission: ActionSubmission) =>
      ipcRenderer.invoke(IPC_CHANNELS.actions.propose, submission) as Promise<
        ActionOperationResult<ActionLifecycleResult>
      >,
    confirm: (confirmationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.actions.confirm, confirmationId) as Promise<
        ActionOperationResult<ActionOutcome>
      >,
    cancel: (confirmationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.actions.cancel, confirmationId) as Promise<
        ActionOperationResult<ActionOutcome>
      >,
    history: {
      list: (input: ActionHistoryListInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.actions.history.list, input) as Promise<
          ActionOperationResult<{ items: ActionHistoryRecord[]; total: number }>
      >
    }
  },
  applications: {
    registerCatalogApplication: (input: RegisterCatalogApplicationInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.registerCatalogApplication, input) as Promise<
        ApplicationOperationResult<CatalogApplicationRegistrationData>
      >,
    registerCustomApplication: (input: RegisterCustomApplicationInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.registerCustomApplication, input) as Promise<
        ApplicationOperationResult<CustomApplicationRegistrationData>
      >,
    list: (input: ApplicationListInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.list, input) as Promise<
        ApplicationOperationResult<ApplicationListData>
      >,
    update: (input: UpdateApplicationInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.update, input) as Promise<
        ApplicationOperationResult<ApplicationMutationData>
      >
  },
  assistant: {
    interpret: (input: AssistantInterpretRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.assistant.interpret, input) as Promise<
        AssistantOperationResult<AssistantInterpretation>
      >,
    context: {
      set: (input: AssistantContextSetInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.assistant.context.set, input) as Promise<
          AssistantOperationResult<AssistantContextData>
        >,
      clear: () =>
        ipcRenderer.invoke(IPC_CHANNELS.assistant.context.clear) as Promise<
          AssistantOperationResult<AssistantContextData>
        >
    }
  },
  voice: {
    transcribe: (input: VoiceTranscriptionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.voice.transcribe, input) as Promise<
        VoiceOperationResult<VoiceTranscriptionData>
      >,
    onGlobalShortcut: (callback: () => void) => {
      const listener = (): void => callback();
      ipcRenderer.on(IPC_CHANNELS.voice.globalShortcutActivated, listener);
      return (): void => {
        ipcRenderer.removeListener(IPC_CHANNELS.voice.globalShortcutActivated, listener);
      };
    }
  },
  speech: {
    speak: (input: { responseId: string }) => ipcRenderer.invoke(IPC_CHANNELS.speech.speak, input) as Promise<OperationResult<import("../shared/speech-contracts").SpeechAudio>>
  },
  settings: {
    voice: {
      get: () =>
        ipcRenderer.invoke(IPC_CHANNELS.settings.voice.get) as Promise<
          SettingsOperationResult<VoicePreferencesData>
        >,
      update: (input: UpdateVoicePreferencesInput) =>
        ipcRenderer.invoke(IPC_CHANNELS.settings.voice.update, input) as Promise<
          SettingsOperationResult<VoicePreferencesData>
        >
    }
  }
} satisfies AresApi;

contextBridge.exposeInMainWorld("ares", aresApi);
