{
  "targets": [
    {
      "target_name": "ares_atomic_no_replace",
      "sources": ["atomic_no_replace.cc"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", { "libraries": ["-lkernel32"] }]
      ]
    }
  ]
}
