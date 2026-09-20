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
  WeekScheduleData
} from "../shared/planner-contracts";
import type {
  ApplicationListData,
  ApplicationListInput,
  ApplicationMutationData,
  ApplicationOperationResult,
  RegisterApplicationInput,
  UpdateApplicationInput
} from "../shared/application-contracts";
import type {
  DashboardOperationResult,
  DashboardTodaySummary
} from "../shared/dashboard-contracts";

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
        >
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
    register: (input: RegisterApplicationInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.register, input) as Promise<
        ApplicationOperationResult<ApplicationMutationData>
      >,
    list: (input: ApplicationListInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.list, input) as Promise<
        ApplicationOperationResult<ApplicationListData>
      >,
    update: (input: UpdateApplicationInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.applications.update, input) as Promise<
        ApplicationOperationResult<ApplicationMutationData>
      >
  }
} satisfies AresApi;

contextBridge.exposeInMainWorld("ares", aresApi);
