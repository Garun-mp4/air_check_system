'use client'

import dynamic from 'next/dynamic'

const SceneCanvas = dynamic(() => import('./scene/SceneCanvas'), { ssr: false, loading: () => <div className="simulator-scene-loading">Загружаем 3D-сцену…</div> })

export default SceneCanvas
