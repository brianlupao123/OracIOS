/**
 * Admin Module Routes — Users, clients, mine sites, plants, equipment, catalog,
 * company profile, commercial ownership, imports, access requests, collections
 */
import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  AdminCreateUserSchema, AdminUpdateUserSchema, AdminCreateClientSchema, AdminUpdateClientSchema,
  AdminCreateMineSiteSchema, AdminUpdateMineSiteSchema, AdminCreatePlantSchema, AdminUpdatePlantSchema,
  AdminCreatePlantSectionSchema, AdminUpdatePlantSectionSchema, AdminCreateEquipmentTagSchema, AdminUpdateEquipmentTagSchema,
  AdminCreateCatalogItemSchema, AdminUpdateCatalogItemSchema, AdminCompanyProfileSchema
} from "../../schemas.js";
import {
  createUser, updateUser, createClient, updateClient,
  createMineSite, updateMineSite, createPlant, updatePlant,
  createPlantSection, updatePlantSection, createEquipmentTag, updateEquipmentTag,
  createCatalogItem, updateCatalogItem, getCompanyProfile, updateCompanyProfile,
  assignCommercialOwnership
} from "../../controllers/adminController.js";
import { approveAccessRequest, rejectAccessRequest, issueAccessRequestSetupLink } from "../../controllers/accessRequestsController.js";
import { downloadImportTemplate, previewMasterDataImport, commitMasterDataImport, listImportJobs, getImportJob } from "../../controllers/importController.js";
import { getSummary, exportPastel, getCollection, reactivateEntity, deactivateEntity } from "../../controllers/coreController.js";
import { getPastelReviewQuotes, getPastelReviewInvoiceReady, previewLeadImport, commitLeadImport, getOperationalAnalytics } from "../../controllers/operationalDataController.js";

const adminRouter = Router();

// Admin CRUD
adminRouter.post("/admin/users", validate(AdminCreateUserSchema), createUser);
adminRouter.patch("/admin/users/:id", validate(AdminUpdateUserSchema), updateUser);
adminRouter.post("/admin/clients", validate(AdminCreateClientSchema), createClient);
adminRouter.patch("/admin/clients/:id", validate(AdminUpdateClientSchema), updateClient);
adminRouter.post("/admin/mine_sites", validate(AdminCreateMineSiteSchema), createMineSite);
adminRouter.patch("/admin/mine_sites/:id", validate(AdminUpdateMineSiteSchema), updateMineSite);
adminRouter.post("/admin/plants", validate(AdminCreatePlantSchema), createPlant);
adminRouter.patch("/admin/plants/:id", validate(AdminUpdatePlantSchema), updatePlant);
adminRouter.post("/admin/plant_sections", validate(AdminCreatePlantSectionSchema), createPlantSection);
adminRouter.patch("/admin/plant_sections/:id", validate(AdminUpdatePlantSectionSchema), updatePlantSection);
adminRouter.post("/admin/equipment_tags", validate(AdminCreateEquipmentTagSchema), createEquipmentTag);
adminRouter.patch("/admin/equipment_tags/:id", validate(AdminUpdateEquipmentTagSchema), updateEquipmentTag);
adminRouter.post("/admin/catalog_items", validate(AdminCreateCatalogItemSchema), createCatalogItem);
adminRouter.patch("/admin/catalog_items/:id", validate(AdminUpdateCatalogItemSchema), updateCatalogItem);
adminRouter.get("/admin/company_profile", getCompanyProfile);
adminRouter.patch("/admin/company_profile", validate(AdminCompanyProfileSchema), updateCompanyProfile);
adminRouter.post("/admin/commercial-ownership/assign", assignCommercialOwnership);

// Access Request Approval
adminRouter.post("/access-requests/:id/approve", approveAccessRequest);
adminRouter.post("/access-requests/:id/reject", rejectAccessRequest);
adminRouter.post("/access-requests/:id/setup-link", issueAccessRequestSetupLink);

// Imports
adminRouter.get("/imports/clients/template", downloadImportTemplate("clients"));
adminRouter.get("/imports/catalog_items/template", downloadImportTemplate("catalog_items"));
adminRouter.post("/imports/clients/preview", previewMasterDataImport("clients"));
adminRouter.post("/imports/clients/commit", commitMasterDataImport("clients"));
adminRouter.post("/imports/catalog_items/preview", previewMasterDataImport("catalog_items"));
adminRouter.post("/imports/catalog_items/commit", commitMasterDataImport("catalog_items"));
adminRouter.get("/imports", listImportJobs);
adminRouter.get("/imports/:id", getImportJob);
adminRouter.post("/imports/leads/preview", previewLeadImport);
adminRouter.post("/imports/leads/commit", commitLeadImport);

// Exports & Analytics
adminRouter.get("/summary", getSummary);
adminRouter.get("/exports/pastel.csv", exportPastel);
adminRouter.get("/exports/pastel-review/quotes.csv", getPastelReviewQuotes);
adminRouter.get("/exports/pastel-review/invoice-ready.csv", getPastelReviewInvoiceReady);
adminRouter.get("/analytics/operational", getOperationalAnalytics);

// Generic Collection Routes
const collections = [
  "users", "clients", "leads", "quotes", "quote_lines",
  "purchase_orders", "dispatch_cards", "field_worksheets", "daily_timesheets", "contractor_log_sheets",
  "invoices", "equipment_tags", "catalog_items", "audit_logs",
  "mine_sites", "plants", "plant_sections",
  "suppliers", "stock_items", "stock_movements",
  "access_requests"
];
collections.forEach((collection) => {
  adminRouter.get(`/${collection}`, getCollection(collection));
  adminRouter.post(`/admin/${collection}/:id/deactivate`, deactivateEntity(collection));
  adminRouter.post(`/admin/${collection}/:id/reactivate`, reactivateEntity(collection));
});

export default adminRouter;
