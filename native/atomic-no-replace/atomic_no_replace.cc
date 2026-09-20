#include <node_api.h>
#include <windows.h>

#include <string>
#include <vector>

namespace {

static_assert(sizeof(wchar_t) == sizeof(char16_t));

napi_value CreateResult(napi_env env, bool succeeded, DWORD error_code) {
  napi_value result;
  napi_create_object(env, &result);

  napi_value succeeded_value;
  napi_get_boolean(env, succeeded, &succeeded_value);
  napi_set_named_property(env, result, "succeeded", succeeded_value);

  napi_value error_code_value;
  napi_create_uint32(env, error_code, &error_code_value);
  napi_set_named_property(env, result, "errorCode", error_code_value);

  return result;
}

bool ReadWideString(napi_env env, napi_value value, std::wstring* output) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok) {
    return false;
  }

  std::vector<char16_t> buffer(length + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) {
    return false;
  }

  output->assign(reinterpret_cast<const wchar_t*>(buffer.data()), length);
  return output->find(L'\0') == std::wstring::npos;
}

napi_value MoveNoReplace(napi_env env, napi_callback_info info) {
  size_t argument_count = 2;
  napi_value arguments[2];
  if (napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr) != napi_ok ||
      argument_count != 2) {
    return CreateResult(env, false, ERROR_INVALID_PARAMETER);
  }

  std::wstring source_path;
  std::wstring destination_path;
  if (!ReadWideString(env, arguments[0], &source_path) ||
      !ReadWideString(env, arguments[1], &destination_path) || source_path.empty() ||
      destination_path.empty()) {
    return CreateResult(env, false, ERROR_INVALID_NAME);
  }

  // MoveFileW has no replace-existing or copy-allowed flags.
  if (MoveFileW(source_path.c_str(), destination_path.c_str()) != 0) {
    return CreateResult(env, true, ERROR_SUCCESS);
  }

  return CreateResult(env, false, GetLastError());
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_value move_no_replace;
  napi_create_function(env, "moveNoReplace", NAPI_AUTO_LENGTH, MoveNoReplace, nullptr, &move_no_replace);
  napi_set_named_property(env, exports, "moveNoReplace", move_no_replace);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
