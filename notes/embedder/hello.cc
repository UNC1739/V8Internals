// 4.7 — ~100-line embedder: Isolate + script + one native function.
// Pin 15.3 API. Not wired into the V8 GN graph (shared checkout).
// Pattern matches samples/hello-world.cc plus a FunctionTemplate.

#include <stdio.h>

#include "include/libplatform/libplatform.h"
#include "include/v8-context.h"
#include "include/v8-function.h"
#include "include/v8-initialization.h"
#include "include/v8-isolate.h"
#include "include/v8-local-handle.h"
#include "include/v8-primitive.h"
#include "include/v8-script.h"
#include "include/v8-template.h"

static void NativeAdd(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  if (info.Length() < 2 || !info[0]->IsNumber() || !info[1]->IsNumber()) {
    isolate->ThrowError("nativeAdd(a, b) needs two numbers");
    return;
  }
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  double a = info[0]->NumberValue(ctx).ToChecked();
  double b = info[1]->NumberValue(ctx).ToChecked();
  info.GetReturnValue().Set(a + b);
}

int main(int argc, char* argv[]) {
  if (!v8::V8::InitializeICUDefaultLocation(argv[0])) {
    fprintf(stderr, "ICU init failed\n");
    return 1;
  }
  v8::V8::InitializeExternalStartupData(argv[0]);
  std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();

  v8::Isolate::CreateParams create_params;
  create_params.array_buffer_allocator =
      v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(create_params);
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);

    v8::Local<v8::ObjectTemplate> global = v8::ObjectTemplate::New(isolate);
    global->Set(isolate, "nativeAdd",
                v8::FunctionTemplate::New(isolate, NativeAdd));

    v8::Local<v8::Context> context = v8::Context::New(isolate, nullptr, global);
    v8::Context::Scope context_scope(context);

    v8::Local<v8::String> source = v8::String::NewFromUtf8Literal(
        isolate, "nativeAdd(40, 2)");
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source).ToLocalChecked();
    v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();
    v8::String::Utf8Value utf8(isolate, result);
    printf("%s\n", *utf8);  // expect 42
  }
  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete create_params.array_buffer_allocator;
  return 0;
}
