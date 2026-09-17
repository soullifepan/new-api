import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    delete: mocks.remove,
  },
}))

import { TapComfyModels } from '..'
import { listTapComfyModels, uploadTapComfyAsset } from '../api'
import { modelFormSchema } from '../form-schema'

afterEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.put.mockReset()
  mocks.remove.mockReset()
})

describe('TapComfy model form', () => {
  it('rejects a model whose uploaded asset references are missing', () => {
    const result = modelFormSchema.safeParse({
      name: 'Chair',
      category: 'furniture',
      format: 'glb',
      file_size: 1,
      sort: 0,
      status: 'published',
      thumbnail_url: '',
      thumbnail_object_key: '',
      model_url: '',
      model_object_key: '',
    })

    expect(result.success).toBe(false)
  })
})

describe('TapComfy model uploads', () => {
  const renderPage = () =>
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(TapComfyModels)
      )
    )

  it('rejects a local file with an unsupported extension', async () => {
    mocks.get.mockResolvedValueOnce({ data: { data: [] } })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '新建模型' }))
    fireEvent.change(screen.getByLabelText('3D 模型文件'), {
      target: { files: [new File(['bad'], 'bad.txt')] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('不支持')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('disables saving while a model upload is pending and clears its error after success', async () => {
    let resolveUpload: ((value: unknown) => void) | undefined
    mocks.get.mockResolvedValueOnce({ data: { data: [] } })
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '新建模型' }))
    const input = screen.getByLabelText('3D 模型文件')
    fireEvent.change(input, {
      target: { files: [new File(['glTF'], 'chair.glb')] },
    })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    if (!resolveUpload) throw new Error('upload resolver was not registered')
    resolveUpload({
      data: {
        url: 'https://example.test/chair.glb',
        objectKey: '3d_models/models/chair.glb',
        assetType: '3d-model',
      },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    )
  })
})

describe('TapComfy model API', () => {
  it('maps the admin catalogue and multipart upload endpoints', async () => {
    mocks.get.mockResolvedValueOnce({ data: { data: [{ id: 'chair' }] } })
    mocks.post.mockResolvedValueOnce({
      data: {
        url: 'https://example.test/model.glb',
        objectKey: '3d_models/models/model.glb',
        assetType: '3d-model',
      },
    })

    await expect(listTapComfyModels()).resolves.toEqual([{ id: 'chair' }])
    await uploadTapComfyAsset(new File(['glTF'], 'model.glb'), '3d-model')

    expect(mocks.get).toHaveBeenCalledWith('/api/tapcomfy/v1/admin/models')
    expect(mocks.post.mock.calls[0][0]).toBe('/api/tapcomfy/v1/admin/assets')
    expect(mocks.post.mock.calls[0][1]).toBeInstanceOf(FormData)
  })
})
