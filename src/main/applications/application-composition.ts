import { createApplicationService, type ApplicationService } from "./application-service";
import {
  createChromeRegistrationService,
  type ChromeRegistrationService
} from "./chrome-registration-service";

let applicationService: ApplicationService | undefined;
let chromeRegistrationService: ChromeRegistrationService | undefined;

export const getApplicationService = (): ApplicationService => {
  applicationService ??= createApplicationService();
  return applicationService;
};

export const getChromeRegistrationService = (): ChromeRegistrationService => {
  chromeRegistrationService ??= createChromeRegistrationService({
    applicationService: getApplicationService()
  });
  return chromeRegistrationService;
};
