import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      '.spec-workflow/**',
      'extension/**',
    ],
  },
)
