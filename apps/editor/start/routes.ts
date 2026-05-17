/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const ProjectsController = () => import('#controllers/projects_controller')
const EditorController = () => import('#controllers/editor_controller')
const CommandsController = () => import('#controllers/commands_controller')
const EditorStateController = () => import('#controllers/editor_state_controller')
const LibraryController = () => import('#controllers/library_controller')
const AssetsController = () => import('#controllers/assets_controller')
const RendersController = () => import('#controllers/renders_controller')

router.on('/').renderInertia('home')

router.get('/editor', [EditorController, 'show'])
router.get('/project-files/*', [EditorController, 'file'])
router.get('/library-files/*', [EditorController, 'libraryFile'])
router.get('/project-renders/:filename', [RendersController, 'file'])

router
  .group(() => {
    router.get('/project', [ProjectsController, 'show'])
    router.post('/project', [ProjectsController, 'load'])
    router.post('/command', [CommandsController, 'apply'])
    router.get('/composition-source', [EditorController, 'compositionSource'])
    router.get('/editor-state', [EditorStateController, 'show'])
    router.put('/editor-state', [EditorStateController, 'update'])
    router.get('/library', [LibraryController, 'index'])
    router.get('/library/thumbnail', [LibraryController, 'thumbnail'])
    router.post('/assets', [AssetsController, 'store'])
    router.post('/renders', [RendersController, 'store'])
    router.get('/renders', [RendersController, 'index'])
    router.get('/renders/:id', [RendersController, 'show'])
    router.get('/renders/:id/events', [RendersController, 'events'])
  })
  .prefix('/api')
