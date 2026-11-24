import { createApplicationService, type ApplicationService } from "./application-service";
import {
  createCustomApplicationRegistrationService,
  type CustomApplicationRegistrationService
} from "./custom-application-registration-service";

let applicationService: ApplicationService | undefined;
let customApplicationRegistrationService: CustomApplicationRegistrationService | undefined;

export const getApplicationService = (): ApplicationService => {
  applicationService ??= createApplicationService();
  return applicationService;
};

export const getCustomApplicationRegistrationService = (): CustomApplicationRegistrationService => {
  customApplicationRegistrationService ??= createCustomApplicationRegistrationService({
    applicationService: getApplicationService()
  });
  return customApplicationRegistrationService;
};
