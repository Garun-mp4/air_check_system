import { NextResponse } from 'next/server'

import { readAccess } from '../../../../server/access'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    return NextResponse.json({ data: await readAccess(request) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { error: { code: 'auth_unavailable', message: 'Не удалось проверить учётную запись' } },
      { status: 503 },
    )
  }
}
