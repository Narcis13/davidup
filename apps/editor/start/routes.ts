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

router.on('/').renderInertia('home')

router.get('/editor', [EditorController, 'show'])
router.get('/project-files/*', [EditorController, 'file'])

router
  .group(() => {
    router.get('/project', [ProjectsController, 'show'])
    router.post('/project', [ProjectsController, 'load'])
    router.post('/command', [CommandsController, 'apply'])
  })
  .prefix('/api')
