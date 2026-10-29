#!/usr/bin/env ruby
# Adds ios/App/App/PrivacyInfo.xcprivacy as a resource of the App target.
# Idempotent — does nothing on re-run.
require 'xcodeproj'

PROJECT = 'ios/App/App.xcodeproj'
FILE_NAME = 'PrivacyInfo.xcprivacy'

project = Xcodeproj::Project.open(PROJECT)
target = project.targets.find { |t| t.name == 'App' }
abort "App target not found in #{PROJECT}" unless target

app_group = project.main_group['App']
abort "App group not found in #{PROJECT}" unless app_group

file_ref = app_group.files.find { |f| f.path == FILE_NAME } \
        || app_group.new_file(FILE_NAME)

resources = target.resources_build_phase
already = resources.files_references.include?(file_ref)
resources.add_file_reference(file_ref) unless already
project.save

puts already ? "  PrivacyInfo.xcprivacy already on App target" \
              : "  PrivacyInfo.xcprivacy registered on App target"
