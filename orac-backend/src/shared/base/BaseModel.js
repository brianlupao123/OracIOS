/**
 * Base model class providing schema definition, defaults, serialisation, and
 * timestamp management for all ORAC domain entities.
 *
 * Not an ORM — this is a lightweight data-shape class. The store layer handles
 * persistence. Models define what an entity looks like and how it serialises.
 *
 * @example
 *   class Vehicle extends BaseModel {
 *     static entityName = "Vehicle";
 *     static fields = {
 *       registration: { type: "string", required: true },
 *       odometer_km:  { type: "number", default: 0 },
 *       status:       { type: "string", default: "active", enum: ["active", "maintenance", "retired"] },
 *     };
 *     static sensitiveFields = [];
 *   }
 *
 *   const v = Vehicle.create({ registration: "AAA-1234" });
 *   // { id: "uuid", registration: "AAA-1234", odometer_km: 0, status: "active", created_at: "...", updated_at: "..." }
 */
export class BaseModel {
  /** @type {string} Human-readable entity name */
  static entityName = "Entity";

  /**
   * Field definitions.
   * @type {Record<string, { type: string, required?: boolean, default?: *, enum?: string[] }>}
   */
  static fields = {};

  /** @type {string[]} Fields stripped from toPublic() output */
  static sensitiveFields = [];

  /**
   * Create a new entity with defaults and timestamps.
   * @param {object} data  Input data (may be partial)
   * @returns {object}  Complete entity with all defaults applied
   */
  static create(data = {}) {
    const now = new Date().toISOString();
    const entity = {
      id: data.id || crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    };

    for (const [field, def] of Object.entries(this.fields)) {
      if (data[field] !== undefined) {
        entity[field] = data[field];
      } else if (def.default !== undefined) {
        entity[field] = typeof def.default === "function" ? def.default() : def.default;
      }
    }

    return entity;
  }

  /**
   * Validate required fields. Returns array of error strings (empty = valid).
   * @param {object} data
   * @returns {string[]}
   */
  static validate(data) {
    const errors = [];
    for (const [field, def] of Object.entries(this.fields)) {
      if (def.required && (data[field] === undefined || data[field] === null || data[field] === "")) {
        errors.push(`${field} is required`);
      }
      if (def.enum && data[field] !== undefined && !def.enum.includes(data[field])) {
        errors.push(`${field} must be one of: ${def.enum.join(", ")}`);
      }
    }
    return errors;
  }

  /**
   * Serialise an entity to JSON, including all fields.
   * @param {object} entity
   * @returns {object}
   */
  static toJSON(entity) {
    return { ...entity };
  }

  /**
   * Serialise an entity for public/client consumption, stripping sensitive fields.
   * @param {object} entity
   * @returns {object}
   */
  static toPublic(entity) {
    const result = { ...entity };
    for (const field of this.sensitiveFields) {
      delete result[field];
    }
    return result;
  }
}
