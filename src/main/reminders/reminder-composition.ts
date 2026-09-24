import { Notification } from "electron";
import {
  createEventDeliveryService,
  type EventDeliveryService
} from "../events/event-delivery-service";
import {
  createReminderDeliveryService,
  type ReminderDeliveryService
} from "./reminder-delivery-service";
import {
  createReminderDeliveryScheduler,
  type ReminderDeliveryScheduler
} from "./reminder-delivery-scheduler";

let reminderDeliveryService: ReminderDeliveryService | undefined;
let eventDeliveryService: EventDeliveryService | undefined;
let reminderDeliveryScheduler: ReminderDeliveryScheduler | undefined;

export const getReminderDeliveryService = (): ReminderDeliveryService => {
  reminderDeliveryService ??= createReminderDeliveryService({
    notificationFactory: (content) => new Notification(content)
  });
  return reminderDeliveryService;
};

export const getEventDeliveryService = (): EventDeliveryService => {
  eventDeliveryService ??= createEventDeliveryService({
    notificationFactory: (content) => new Notification(content)
  });
  return eventDeliveryService;
};

export const getReminderDeliveryScheduler = (): ReminderDeliveryScheduler => {
  reminderDeliveryScheduler ??= createReminderDeliveryScheduler({
    service: getReminderDeliveryService(),
    eventService: getEventDeliveryService()
  });
  return reminderDeliveryScheduler;
};
