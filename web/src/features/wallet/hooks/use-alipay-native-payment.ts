import { useCallback, useEffect, useRef, useState } from 'react'

import { handleServerError } from '@/lib/handle-server-error'

import {
  calculateAlipayNativeAmount,
  getAlipayNativeOrder,
  isApiSuccess,
  requestAlipayNativePayment,
} from '../api'
import type { AlipayNativeOrder, AlipayNativePayment } from '../types'

const POLL_INTERVAL_MS = 2500

export function useAlipayNativePayment(onSuccess: () => Promise<void>) {
  const [payment, setPayment] = useState<AlipayNativePayment | null>(null)
  const [status, setStatus] = useState<
    'pending' | 'failed' | 'expired' | 'network-error'
  >('pending')
  const [processing, setProcessing] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const inFlightRef = useRef(false)
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  const close = useCallback(() => {
    setPayment(null)
    setStatus('pending')
  }, [])
  const retry = useCallback(() => {
    setStatus('pending')
    setRetryCount((count) => count + 1)
  }, [])

  const start = useCallback(async (amount: number) => {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    setProcessing(true)
    try {
      const response = await requestAlipayNativePayment({ amount })
      if (
        !isApiSuccess(response) ||
        !response.data ||
        typeof response.data !== 'object'
      ) {
        if (response.trade_no) {
          setPayment({ trade_no: response.trade_no })
          setStatus('pending')
          return true
        }
        handleServerError(response)
        return false
      }
      setPayment(response.data)
      setStatus('pending')
      return true
    } catch (error) {
      handleServerError(error)
      return false
    } finally {
      inFlightRef.current = false
      setProcessing(false)
    }
  }, [])

  useEffect(() => {
    if (!payment?.trade_no) return
    let stopped = false
    let timer: number | undefined
    let polling = false

    const poll = async () => {
      if (stopped || polling) return
      polling = true
      let shouldSchedule = true
      try {
        const response = await getAlipayNativeOrder(payment.trade_no)
        if (stopped) return
        const order: AlipayNativeOrder | undefined = response.data
        if (isApiSuccess(response) && order?.status === 'success') {
          setPayment(null)
          shouldSchedule = false
          await onSuccessRef.current()
          return
        }
        if (isApiSuccess(response) && order?.status === 'pending') {
          setStatus('pending')
          return
        }
        if (isApiSuccess(response) && (order?.status === 'failed' || order?.status === 'expired')) {
          setStatus(order.status)
          shouldSchedule = false
          return
        }
        setStatus('network-error')
        shouldSchedule = false
      } catch {
        if (stopped) return
        setStatus('network-error')
        shouldSchedule = false
      } finally {
        polling = false
        if (!stopped && shouldSchedule) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        }
      }
    }

    void poll()
    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [payment?.trade_no, retryCount])

  return {
    payment,
    status,
    processing,
    start,
    close,
    retry,
    calculateAlipayNativeAmount,
  }
}
