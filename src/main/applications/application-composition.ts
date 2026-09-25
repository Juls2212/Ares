import { createApplicationService, type ApplicationService } from "./application-service";
import {
  createCatalogApplicationRegistrationService,
  type CatalogApplicationRegistrationService
} from "./catalog-application-registration-service";
import {
  createCustomApplicationRegistrationService,
  type CustomApplicationRegistrationService
} from "./custom-application-registration-service";

let applicationService: ApplicationService | undefined;
let catalogApplicationRegistrationService: CatalogApplicationRegistrationService | undefined;
let customApplicationRegistrationService: CustomApplicationRegistrationService | undefined;

export const getApplicationService = (): ApplicationService => {
  applicationService ??= createApplicationService();
  return applicationService;
};

export const getCatalogApplicationRegistrationService = (): CatalogApplicationRegistrationService => {
  catalogApplicationRegistrationService ??= createCatalogApplicationRegistrationService({
    applicationService: getApplicationService()
  });
  return catalogApplicationRegistrationService;
};

export const getCustomApplicationRegistrationService = (): CustomApplicationRegistrationService => {
  customApplicationRegistrationService ??= createCustomApplicationRegistrationService({
    applicationService: getApplicationService()
  });
  return customApplicationRegistrationService;
};
