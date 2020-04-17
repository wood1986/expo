#pragma once

#include <jsi/jsi.h>

namespace jsi = facebook::jsi;

enum class TypedArrayKind {
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};

template <TypedArrayKind T>
class TypedArray;

template <TypedArrayKind T>
struct typedArrayTypeMap;
template <>
struct typedArrayTypeMap<TypedArrayKind::Int8Array> {
  typedef int8_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Int16Array> {
  typedef int16_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Int32Array> {
  typedef int32_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Uint8Array> {
  typedef uint8_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Uint8ClampedArray> {
  typedef uint8_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Uint16Array> {
  typedef uint16_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Uint32Array> {
  typedef uint32_t type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Float32Array> {
  typedef float type;
};
template <>
struct typedArrayTypeMap<TypedArrayKind::Float64Array> {
  typedef double type;
};

class TypedArrayBase : public jsi::Object {
 public:
  template <TypedArrayKind T>
  using ContentType = typename typedArrayTypeMap<T>::type;

  TypedArrayBase(jsi::Runtime &runtime, size_t size, TypedArrayKind kind)
      : TypedArrayBase(runtime, TypedArrayBase::createTypedArray(runtime, size, kind)){};

  TypedArrayBase(jsi::Runtime &runtime, const jsi::Object &obj)
      : jsi::Object(jsi::Value(runtime, obj).asObject(runtime)) {}

  TypedArrayBase(TypedArrayBase &&) = default;
  TypedArrayBase &operator=(TypedArrayBase &&) = default;

  static jsi::Object createTypedArray(jsi::Runtime &runtime, size_t size, TypedArrayKind kind) {
    return runtime.global()
        .getProperty(
            runtime, jsi::String::createFromUtf8(runtime, getTypedArrayConstructorName(kind)))
        .asObject(runtime)
        .asFunction(runtime)
        .callAsConstructor(runtime, {static_cast<double>(size)})
        .asObject(runtime);
  }
  TypedArrayKind getKind(jsi::Runtime &runtime) const {
    auto constructorName = this->getProperty(runtime, "__proto__")
                               .asObject(runtime)
                               .getProperty(runtime, "constructor")
                               .asObject(runtime)
                               .getProperty(runtime, "name")
                               .asString(runtime)
                               .utf8(runtime);
    return TypedArrayBase::getTypedArrayKindForName(constructorName);
  };

  template <TypedArrayKind T>
  TypedArray<T> get(jsi::Runtime &runtime) const & {
    assert(getKind(runtime) == T);
    (void)runtime; // when assert is disabled we need to mark this as used
    return TypedArray<T>(jsi::Value(runtime, jsi::Value(runtime, *this).asObject(runtime)));
  }

  template <TypedArrayKind T>
  TypedArray<T> get(jsi::Runtime &runtime) && {
    assert(getKind(runtime) == T);
    (void)runtime; // when assert is disabled we need to mark this as used
    return TypedArray<T>(std::move(*this));
  }

  template <TypedArrayKind T>
  TypedArray<T> as(jsi::Runtime &runtime) const & {
    if (getKind(runtime) != T) {
      throw jsi::JSError(runtime, "Object is not a TypedArray");
    }
    return get<T>(runtime);
  }

  template <TypedArrayKind T>
  TypedArray<T> as(jsi::Runtime &runtime) && {
    if (getKind(runtime) != T) {
      throw jsi::JSError(runtime, "Object is not a TypedArray");
    }
    return std::move(*this).get<T>(runtime);
  }

  size_t size(jsi::Runtime &runtime) const {
    return getProperty(runtime, "length").asNumber();
  }

  size_t length(jsi::Runtime &runtime) const {
    return getProperty(runtime, "length").asNumber();
  }

  size_t byteLength(jsi::Runtime &runtime) const {
    return getProperty(runtime, "byteLength").asNumber();
  }

  size_t byteOffset(jsi::Runtime &runtime) const {
    return getProperty(runtime, "byteOffset").asNumber();
  }

  bool hasBuffer(jsi::Runtime &runtime) const {
    auto buffer = getProperty(runtime, "buffer");
    return buffer.isObject() && buffer.asObject(runtime).isArrayBuffer(runtime);
  }

  jsi::ArrayBuffer getBuffer(jsi::Runtime &runtime) const {
    auto buffer = getProperty(runtime, "buffer");
    if (buffer.isObject() && buffer.asObject(runtime).isArrayBuffer(runtime)) {
      return buffer.asObject(runtime).getArrayBuffer(runtime);
    } else {
      throw std::runtime_error("no ArrayBuffer attached");
    }
  }

 private:
  template <TypedArrayKind>
  friend class TypedArray;

  static std::string getTypedArrayConstructorName(TypedArrayKind kind) {
    switch (kind) {
      case TypedArrayKind::Int8Array:
        return "Int8Array";
      case TypedArrayKind::Int16Array:
        return "Int16Array";
      case TypedArrayKind::Int32Array:
        return "Int32Array";
      case TypedArrayKind::Uint8Array:
        return "Uint8Array";
      case TypedArrayKind::Uint8ClampedArray:
        return "Uint8ClampedArray";
      case TypedArrayKind::Uint16Array:
        return "Uint16Array";
      case TypedArrayKind::Uint32Array:
        return "Uint32Array";
      case TypedArrayKind::Float32Array:
        return "Float32Array";
      case TypedArrayKind::Float64Array:
        return "Float64Array";
    }
  }

  static TypedArrayKind getTypedArrayKindForName(std::string name) {
    if (name == "Int8Array")
      return TypedArrayKind::Int8Array;
    if (name == "Int16Array")
      return TypedArrayKind::Int16Array;
    if (name == "Int32Array")
      return TypedArrayKind::Int32Array;
    if (name == "Uint8Array")
      return TypedArrayKind::Uint8Array;
    if (name == "Uint8ClampedArray")
      return TypedArrayKind::Uint8ClampedArray;
    if (name == "Uint16Array")
      return TypedArrayKind::Uint16Array;
    if (name == "Uint32Array")
      return TypedArrayKind::Uint32Array;
    if (name == "Float32Array")
      return TypedArrayKind::Float32Array;
    if (name == "Float64Array")
      return TypedArrayKind::Float64Array;
    throw std::runtime_error("unknown type");
  }
};

inline bool isTypedArray(jsi::Runtime &runtime, const jsi::Object &jsObj) {
  auto jsVal = runtime.global()
                   .getProperty(runtime, "ArrayBuffer")
                   .asObject(runtime)
                   .getProperty(runtime, "isView")
                   .asObject(runtime)
                   .asFunction(runtime)
                   .callWithThis(runtime, runtime.global(), {jsi::Value(runtime, jsObj)});
  if (jsVal.isBool()) {
    return jsVal.getBool();
  } else {
    throw std::runtime_error("value is not a boolean");
  }
}

inline TypedArrayBase getTypedArray(jsi::Runtime &runtime, const jsi::Object &jsObj) {
  auto jsVal = runtime.global()
                   .getProperty(runtime, "ArrayBuffer")
                   .asObject(runtime)
                   .getProperty(runtime, "isView")
                   .asObject(runtime)
                   .asFunction(runtime)
                   .callWithThis(runtime, runtime.global(), {jsi::Value(runtime, jsObj)});
  if (jsVal.isBool()) {
    return TypedArrayBase(runtime, jsObj);
  } else {
    throw std::runtime_error("value is not a boolean");
  }
}

inline std::vector<uint8_t> arrayBufferToVector(jsi::Runtime &runtime, jsi::Object &jsObj) {
  if (!jsObj.isArrayBuffer(runtime)) {
    throw std::runtime_error("Object is not an ArrayBuffer");
  }
  auto jsArrayBuffer = jsObj.getArrayBuffer(runtime);

  uint8_t *dataBlock = jsArrayBuffer.data(runtime);
  size_t blockSize = jsArrayBuffer.getProperty(runtime, "byteLength").asNumber();
  return std::vector<uint8_t>(dataBlock, dataBlock + blockSize);
}

inline void arrayBufferUpdate(
    jsi::Runtime &runtime,
    jsi::ArrayBuffer &buffer,
    std::vector<uint8_t> data,
    size_t offset) {
  uint8_t *dataBlock = buffer.data(runtime);
  size_t blockSize = buffer.size(runtime);
  if (data.size() > blockSize) {
    throw jsi::JSError(runtime, "ArrayBuffer is to small to fit data");
  }
  std::copy(data.begin(), data.end(), dataBlock + offset);
}

template <TypedArrayKind T>
class TypedArray : public TypedArrayBase {
 public:
  TypedArray(jsi::Runtime &runtime, size_t size)
      : TypedArrayBase(runtime, TypedArrayBase::createTypedArray(runtime, size, T)){};

  TypedArray(jsi::Runtime &runtime, std::vector<ContentType<T>> data)
      : TypedArrayBase(runtime, TypedArrayBase::createTypedArray(runtime, data.size(), T)) {
    update(runtime, data);
  };

  TypedArray(TypedArrayBase &&base) : TypedArrayBase(std::move(base)) {}

  TypedArray(TypedArray &&) = default;
  TypedArray &operator=(TypedArray &&) = default;

  std::vector<ContentType<T>> toVector(jsi::Runtime &runtime) {
    auto start =
        reinterpret_cast<ContentType<T> *>(getBuffer(runtime).data(runtime) + byteOffset(runtime));
    auto end = start + size(runtime);
    return std::vector<ContentType<T>>(start, end);
  }

  void update(jsi::Runtime &runtime, const std::vector<ContentType<T>>& data) {
    if (data.size() != size(runtime)) {
      throw jsi::JSError(runtime, "TypedArray can only be updated with a vector of the same size");
    }
    uint8_t *rawData = getBuffer(runtime).data(runtime) + byteOffset(runtime);
    std::copy(data.begin(), data.end(), reinterpret_cast<ContentType<T> *>(rawData));
  }

 private:
  friend TypedArrayBase;
};
