import type { HttpRequest } from '@angular/common/http';
import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import type { AiProviderConfig, Assignee, Company, SupportType, SystemModule, User } from '../core/api';

/** What the server answers to the read of the shared catalogs. A catalog a spec leaves out is empty. */
export interface CatalogsAnswer {
  users?: User[];
  assignees?: Assignee[];
  companies?: Company[];
  supportTypes?: SupportType[];
  /** Every module, the inactive ones too: the catalogs ask for them whole. */
  modules?: SystemModule[];
  ai?: AiProviderConfig[];
}

/** A read of every module, active or not (`GET /modules?all=1`): the one of the shared catalogs, and the one the modules tab of Configuración makes for its own list. */
export function isEveryModuleRead(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url === '/api/modules' && request.params.get('all') === '1';
}

/**
 * For specs: answers one read of the shared catalogs (`Catalogs.reload`), which the shell starts
 * with and every tab of Configuración ends its writes with. It is one request per catalog, and
 * each has to be on its way: a read that did not happen fails the spec here.
 *
 * `modulesRead`: the read of the modules, for a spec that had to pick it out itself because the
 * screen it tests asks for the same list at the same time (see `isEveryModuleRead`).
 */
export function answerCatalogs(http: HttpTestingController, answer: CatalogsAnswer = {}, modulesRead?: TestRequest): void {
  http.expectOne({ method: 'GET', url: '/api/users' }).flush(answer.users ?? []);
  http.expectOne({ method: 'GET', url: '/api/assignees' }).flush(answer.assignees ?? []);
  http.expectOne({ method: 'GET', url: '/api/companies' }).flush(answer.companies ?? []);
  http.expectOne({ method: 'GET', url: '/api/support-types' }).flush(answer.supportTypes ?? []);
  (modulesRead ?? http.expectOne(isEveryModuleRead)).flush(answer.modules ?? []);
  http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush(answer.ai ?? []);
}
