module.exports = function(grunt) {
  grunt.loadNpmTasks('grunt-browserify')

  grunt.initConfig({
    browserify: {
      options: {
        debug: true
      },
      module: {
        files: {
          './deploy/module/module.js': ['./js/*.js']
        }
      },

    }
  })

  grunt.registerTask('default', ['browserify'])
}
