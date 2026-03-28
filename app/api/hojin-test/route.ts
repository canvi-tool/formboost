import { NextRequest, NextResponse } from 'next/server'

// Debug endpoint for NTA corporate number API
// GET /api/hojin-test?number=4180301018771
// Results: 404 = app ID not registered, 200 = working

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const number = searchParams.get('number') || '4180301018771' // default: Toyota

  const startTime = Date.now()
  const results: Record<string, unknown> = {
    number,
    timestamp: new Date().toISOString(),
    note: 'NTA API requires app ID registration (2-4 weeks). id=formboost is not registered. Apply at: https://www.houjin-bangou.nta.go.jp/webapi/'
  }

  // Endpoint A: v4 with output=json
  try {
    const urlA = `https://api.houjin-bangou.nta.go.jp/4/num?id=formboost&number=${number}&type=12&output=json`
    results['endpoint_A_url'] = urlA
    const resA = await fetch(urlA, { signal: AbortSignal.timeout(8000) })
    results['endpoint_A_status'] = resA.status
    results['endpoint_A_ok'] = resA.ok
    results['endpoint_A_ms'] = Date.now() - startTime
    if (resA.ok) {
      const dataA = await resA.json()
      results['endpoint_A_data'] = dataA
      results['endpoint_A_corp'] = dataA.corporation?.[0] ?? null
    } else {
      const body = await resA.text()
      results['endpoint_A_error'] = resA.status === 404
        ? 'App ID not registered (takes 2-4 weeks). id=formboost is not valid. Register at NTA site.'
        : `${resA.status}: ${body.slice(0, 200)}`
    }
  } catch (e: unknown) {
    results['endpoint_A_error'] = e instanceof Error ? e.message : String(e)
    results['endpoint_A_ms'] = Date.now() - startTime
  }

  // Endpoint B: v4 without output=json
  const t2 = Date.now()
  try {
    const urlB = `https://api.houjin-bangou.nta.go.jp/4/num?id=formboost&number=${number}&type=12`
    results['endpoint_B_url'] = urlB
    const resB = await fetch(urlB, { signal: AbortSignal.timeout(8000) })
    results['endpoint_B_status'] = resB.status
    results['endpoint_B_ok'] = resB.ok
    results['endpoint_B_ms'] = Date.now() - t2
    if (resB.ok) {
      results['endpoint_B_data'] = await resB.json()
    } else {
      results['endpoint_B_error'] = resB.status === 404
        ? 'App ID not registered'
        : await resB.text()
    }
  } catch (e: unknown) {
    results['endpoint_B_error'] = e instanceof Error ? e.message : String(e)
    results['endpoint_B_ms'] = Date.now() - t2
  }

  // Endpoint C: v3 (older version)
  const t3 = Date.now()
  try {
    const urlC = `https://api.houjin-bangou.nta.go.jp/3/num?id=formboost&number=${number}&type=12`
    results['endpoint_C_url'] = urlC
    const resC = await fetch(urlC, { signal: AbortSignal.timeout(8000) })
    results['endpoint_C_status'] = resC.status
    results['endpoint_C_ok'] = resC.ok
    results['endpoint_C_ms'] = Date.now() - t3
    if (resC.ok) {
      results['endpoint_C_data'] = await resC.json()
    } else {
      results['endpoint_C_error'] = resC.status === 404
        ? 'App ID not registered'
        : await resC.text()
    }
  } catch (e: unknown) {
    results['endpoint_C_error'] = e instanceof Error ? e.message : String(e)
    results['endpoint_C_ms'] = Date.now() - t3
  }

  results['total_ms'] = Date.now() - startTime

  return NextResponse.json(results, { status: 200 })
}
