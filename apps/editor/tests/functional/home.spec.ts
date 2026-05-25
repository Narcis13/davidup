import { test } from '@japa/runner'

test.group('Home', () => {
  test('GET / renders the home page', async ({ client }) => {
    const response = await client.get('/')
    response.assertStatus(200)
    response.assertTextIncludes('AdonisJS x Inertia x VueJS')
  })
})
