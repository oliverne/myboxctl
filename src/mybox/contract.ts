import { z } from "zod";

const nonEmptyString = z.string().min(1);
const finiteNumber = z.number().refine(Number.isFinite, "must be finite");
const nonNegativeNumber = finiteNumber.nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();

export const resourceItemSchema = z
  .object({
    resourceId: nonEmptyString,
    parentId: nonEmptyString,
    name: nonEmptyString,
    type: nonEmptyString,
    size: nonNegativeNumber,
    createdAt: nonEmptyString,
    modifiedAt: nonEmptyString,
    accessedAt: nonEmptyString,
    isFavorite: z.boolean(),
    isHidden: z.boolean(),
    lastModifiedBy: z.string(),
    path: nonEmptyString.optional(),
    parentPath: z.string().optional(),
  })
  .passthrough();

export const searchResourceItemSchema = z
  .object({
    resourceId: nonEmptyString,
    name: nonEmptyString,
    type: nonEmptyString.optional(),
    parentId: nonEmptyString.optional(),
    path: nonEmptyString.optional(),
    parentPath: z.string().optional(),
    size: nonNegativeNumber.optional(),
    createdAt: nonEmptyString.optional(),
    modifiedAt: nonEmptyString.optional(),
    accessedAt: nonEmptyString.optional(),
    isFavorite: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    lastModifiedBy: z.string().optional(),
  })
  .passthrough();

export const resourceDetailSchema = resourceItemSchema;

export const responseMetaDataSchema = z
  .object({
    nextCursor: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export const resourceListResponseSchema = z
  .object({
    resources: z.array(resourceItemSchema),
    responseMetaData: responseMetaDataSchema,
    fileCount: nonNegativeNumber,
    subFolderCount: nonNegativeNumber,
  })
  .passthrough();

export const searchResourceListResponseSchema = z
  .object({
    resources: z.array(searchResourceItemSchema).default([]),
    responseMetaData: responseMetaDataSchema.default({}),
    fileCount: nonNegativeNumber.optional(),
    subFolderCount: nonNegativeNumber.optional(),
  })
  .passthrough();

export const createFolderResponseSchema = z
  .object({
    name: nonEmptyString,
    resourceId: nonEmptyString,
  })
  .passthrough();

export const createUploadResponseSchema = z
  .object({
    uploadUrl: z.url(),
    offset: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const storageFileCountsSchema = z
  .object({
    archive: nonNegativeInteger,
    audio: nonNegativeInteger,
    document: nonNegativeInteger,
    etc: nonNegativeInteger,
    executable: nonNegativeInteger,
    image: nonNegativeInteger,
    total: nonNegativeInteger,
    video: nonNegativeInteger,
  })
  .passthrough();

export const storageResponseSchema = z
  .object({
    fileCounts: storageFileCountsSchema,
    maxFileBytes: nonNegativeInteger,
    quotaBytes: nonNegativeInteger,
    trashAutoDeleteDays: nonNegativeInteger,
    usedBytes: nonNegativeInteger,
  })
  .passthrough();

export const uploadContentResponseSchema = z
  .object({
    resourceId: nonEmptyString,
    name: nonEmptyString,
    fileSize: nonNegativeNumber,
  })
  .passthrough();

export const myboxErrorSchema = z
  .object({
    code: nonEmptyString,
    message: nonEmptyString,
    requestId: nonEmptyString.optional(),
    timestamp: nonEmptyString.optional(),
  })
  .passthrough();

export type ResourceItem = z.infer<typeof resourceItemSchema>;
export type SearchResourceItem = z.infer<typeof searchResourceItemSchema>;
export type ResourceDetail = z.infer<typeof resourceDetailSchema>;
export type ResponseMetaData = z.infer<typeof responseMetaDataSchema>;
export type ResourceListResponse = z.infer<typeof resourceListResponseSchema>;
export type SearchResourceListResponse = z.infer<typeof searchResourceListResponseSchema>;
export type CreateFolderResponse = z.infer<typeof createFolderResponseSchema>;
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;
export type StorageFileCounts = z.infer<typeof storageFileCountsSchema>;
export type StorageResponse = z.infer<typeof storageResponseSchema>;
export type UploadContentResponse = z.infer<typeof uploadContentResponseSchema>;
export type MyboxError = z.infer<typeof myboxErrorSchema>;
