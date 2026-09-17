/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api, type ApiRequestConfig } from '@/lib/api'

import type {
  TapComfyModel,
  TapComfyModelInput,
  UploadedTapComfyAsset,
} from './types'

const mutationConfig: ApiRequestConfig = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

export async function listTapComfyModels(): Promise<TapComfyModel[]> {
  const response = await api.get<{ data: TapComfyModel[] }>(
    '/api/tapcomfy/v1/admin/models'
  )
  return response.data.data ?? []
}

export async function createTapComfyModel(input: TapComfyModelInput) {
  const response = await api.post<TapComfyModel>(
    '/api/tapcomfy/v1/admin/models',
    input,
    mutationConfig
  )
  return response.data
}

export async function updateTapComfyModel(
  id: string,
  input: TapComfyModelInput
) {
  const response = await api.put<TapComfyModel>(
    `/api/tapcomfy/v1/admin/models/${encodeURIComponent(id)}`,
    input,
    mutationConfig
  )
  return response.data
}

export async function deleteTapComfyModel(id: string) {
  await api.delete(
    `/api/tapcomfy/v1/admin/models/${encodeURIComponent(id)}`,
    mutationConfig
  )
}

export async function uploadTapComfyAsset(
  file: File,
  assetType: UploadedTapComfyAsset['assetType']
): Promise<UploadedTapComfyAsset> {
  const form = new FormData()
  form.append('file', file)
  form.append('assetType', assetType)
  const response = await api.post<UploadedTapComfyAsset>(
    '/api/tapcomfy/v1/admin/assets',
    form,
    mutationConfig
  )
  return response.data
}
