import { NextResponse } from 'next/server'
import { errorResponse } from '../../../../server/api'
import { requireSignedIn, accessErrorResponse } from '../../../../server/access'
import {
  longHistory,
  parseLongHistory,
  historyCsv,
} from '../../../../server/long-history'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  try {
    await requireSignedIn(request)
    const params = new URL(request.url).searchParams
    const data = await longHistory(parseLongHistory(params))
    if (params.get('format') === 'csv')
      return new Response('\uFEFF' + historyCsv(data), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="aircheck-${data.days}days.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return accessErrorResponse(error) ?? errorResponse(error)
  }
}
