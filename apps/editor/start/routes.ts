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

router.on('/').renderInertia('home')

router
  .group(() => {
    router.get('/project', [ProjectsController, 'show'])
    router.post('/project', [ProjectsController, 'load'])
  })
  .prefix('/api')
