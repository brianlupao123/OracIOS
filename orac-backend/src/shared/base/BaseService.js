import { NotFoundError } from "../errors/NotFoundError.js";

/**
 * Base service providing standard CRUD operations against the in-memory store.
 *
 * Extend this in domain services, overriding `entityName` and `storeName`
 * to get create / findById / findAll / update / softDelete / count for free.
 *
 * The ORAC store uses arrays for every collection (Decision D11).
 *
 * @example
 *   class VehicleService extends BaseService {
 *     entityName = "Vehicle";
 *     storeName = "vehicles";
 *   }
 *   const service = new VehicleService(store);
 *   const vehicle = service.findById("v-123"); // throws NotFoundError if missing
 */
export class BaseService {
  /** @type {string} Human-readable entity name for error messages */
  entityName = "Entity";

  /** @type {string} Key used to look up the collection in the store */
  storeName = "entities";

  /**
   * @param {object} store  The ORAC dual-mode store (Memory/Postgres adapter)
   */
  constructor(store) {
    this.store = store;
  }

  /**
   * Retrieve the backing collection from the store.
   * @returns {Array}
   */
  _collection() {
    return this.store[this.storeName] || [];
  }

  /**
   * Create a new entity.
   * @param {object} data
   * @returns {object}  Created entity
   */
  create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const entity = {
      id,
      ...data,
      created_at: data.created_at || now,
      updated_at: now,
    };
    const collection = this._collection();
    collection.push(entity);
    return entity;
  }

  /**
   * Find an entity by ID, throwing NotFoundError if missing.
   * @param {string} id
   * @returns {object}
   */
  findById(id) {
    const collection = this._collection();
    const entity = collection.find((e) => e.id === id);
    if (!entity) {
      throw new NotFoundError(this.entityName, id);
    }
    return entity;
  }

  /**
   * Return all entities, optionally filtered and paginated.
   * @param {object} [options]
   * @param {Function} [options.filter]  Predicate function
   * @param {number} [options.page]  1-based page number
   * @param {number} [options.limit]  Items per page
   * @returns {{ items: object[], meta: { page: number, limit: number, total: number } }}
   */
  findAll(options = {}) {
    const collection = this._collection();
    let items = [...collection];

    // Apply filter
    if (typeof options.filter === "function") {
      items = items.filter(options.filter);
    }

    // Exclude soft-deleted by default
    items = items.filter((e) => !e.deleted_at);

    const total = items.length;
    const page = options.page || 1;
    const limit = options.limit || 25;
    const offset = (page - 1) * limit;

    return {
      items: items.slice(offset, offset + limit),
      meta: { page, limit, total },
    };
  }

  /**
   * Update an entity by ID. Merges fields.
   * @param {string} id
   * @param {object} updates
   * @returns {object}  Updated entity
   */
  update(id, updates) {
    const entity = this.findById(id); // throws NotFoundError if missing
    Object.assign(entity, updates, { updated_at: new Date().toISOString() });
    return entity;
  }

  /**
   * Soft-delete: set `deleted_at` timestamp.
   * @param {string} id
   * @returns {object}
   */
  softDelete(id) {
    return this.update(id, { deleted_at: new Date().toISOString() });
  }

  /**
   * Count entities matching an optional filter.
   * @param {Function} [filter]
   * @returns {number}
   */
  count(filter) {
    const collection = this._collection();
    let items = [...collection];
    items = items.filter((e) => !e.deleted_at);
    if (typeof filter === "function") {
      items = items.filter(filter);
    }
    return items.length;
  }
}
