{
  "targets": [
    {
      "target_name": "bpm_native",
      "sources": [
        "src/bpm_native.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "NODE_ADDON_API_DISABLE_DEPRECATED"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "Optimization": "3",
          "EnableEnhancedInstructionSet": "5",
          "FloatingPointModel": "2",
          "AdditionalOptions": ["/O2", "/arch:AVX2", "/fp:fast", "/permissive-", "/Zc:__cplusplus", "/utf-8", "/EHsc"]
        },
        "VCLinkerTool": {
          "AdditionalDependencies": ["ole32.lib", "avrt.lib"]
        }
      }
    }
  ]
}
