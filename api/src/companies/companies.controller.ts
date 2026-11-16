import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe';
import { CompaniesService, CompanyInput } from './companies.service';
import type { CompanyDto } from './companies.service';

/** The client companies that report cases (`COMPANIES`). */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  /** Every company, active first. The screens that register a case offer the active ones. */
  @Get()
  list(): Promise<CompanyDto[]> {
    return this.companies.list();
  }

  @Post()
  create(@Body() dto: CompanyInput): Promise<CompanyDto> {
    return this.companies.create(dto);
  }

  /** A new name also goes to the search key of the cases of the company, in the same transaction. */
  @Patch(':id')
  update(@Param('id', IdPipe) id: number, @Body() dto: CompanyInput): Promise<CompanyDto> {
    return this.companies.update(id, dto);
  }

  /** Only a company without cases. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', IdPipe) id: number): Promise<void> {
    return this.companies.remove(id);
  }
}
