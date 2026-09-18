import { createApplicationService, type ApplicationService } from "./application-service";

let applicationService: ApplicationService | undefined;

export const getApplicationService = (): ApplicationService => {
  applicationService ??= createApplicationService();
  return applicationService;
};
