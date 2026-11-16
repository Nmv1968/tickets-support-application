import { Module } from '@nestjs/common';
import { AssigneesController } from './assignees/assignees.controller';
import { AssigneesService } from './assignees/assignees.service';
import { CatalogController } from './catalog/catalog.controller';
import { ModulesService } from './catalog/modules.service';
import { SlaService } from './catalog/sla.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { SupportTypesController } from './support-types/support-types.controller';
import { SupportTypesService } from './support-types/support-types.service';

/**
 * The catalogs a case chooses from: the responsibles, the companies, the support types, and the
 * modules with the SLA. The first three are catalogs of names, one implementation for all of them
 * (`NamedCatalogService`, in common/named-catalog.ts).
 */
@Module({
  controllers: [AssigneesController, CompaniesController, SupportTypesController, CatalogController],
  providers: [AssigneesService, CompaniesService, SupportTypesService, ModulesService, SlaService],
})
export class CatalogsModule {}
