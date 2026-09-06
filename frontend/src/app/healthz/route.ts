import { NextResponse } from 'next/server'

import { getConfig } from '../../server/config'
import { getRepository } from '../../server/repository'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const config = getConfig()
    await getRepository(config.databaseUrl).ping()
    return NextResponse.json({ status: 'ok', database: 'ok' })
  } catch {
    return NextResponse.json(
      { status: 'degraded', database: 'unavailable' },
      { status: 503 },
    )
  }
}
