import { Notification } from "electron";
import {
  createReminderDeliveryService,
  type ReminderDeliveryService
} from "./reminder-delivery-service";
import {
  createReminderDeliveryScheduler,
  type ReminderDeliveryScheduler
} from "./reminder-delivery-scheduler";

let reminderDeliveryService: ReminderDeliveryService | undefined;
let reminderDeliveryScheduler: ReminderDeliveryScheduler | undefined;

export const getReminderDeliveryService = (): ReminderDeliveryService => {
  reminderDeliveryService ??= createReminderDeliveryService({
    notificationFactory: (content) => new Notification(content)
  });
  return reminderDeliveryService;
};

export const getReminderDeliveryScheduler = (): ReminderDeliveryScheduler => {
  reminderDeliveryScheduler ??= createReminderDeliveryScheduler({
    service: getReminderDeliveryService()
  });
  return reminderDeliveryScheduler;
};
