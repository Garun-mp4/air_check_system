'use client'
import { Text } from '@react-three/drei'
import { Suspense, type ComponentProps } from 'react'

export const SCENE_FONT = '/fonts/AirCheckScene.ttf'
export function SceneText(props: ComponentProps<typeof Text>) {
  return <Suspense fallback={null}><Text {...props} font={SCENE_FONT} /></Suspense>
}
