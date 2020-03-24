export var FileSystemSessionType;
(function (FileSystemSessionType) {
    /*
     * The session will work even if the user backgrounds an application.
     *
     * If a task complete when the application is inactive, the promise might resolve immediately.
     * However, js code will be stopped after a couple of seconds and it will be resume when the user comes back to the application.
     */
    FileSystemSessionType[FileSystemSessionType["BACKGROUND"] = 0] = "BACKGROUND";
    /*
     * The session will be killed when an application is inactive.
     * When the user comes back to the application, the promise will be rejected.
     */
    FileSystemSessionType[FileSystemSessionType["FOREGROUND"] = 1] = "FOREGROUND";
})(FileSystemSessionType || (FileSystemSessionType = {}));
export var FileSystemUploadType;
(function (FileSystemUploadType) {
    FileSystemUploadType[FileSystemUploadType["BINARY_CONTENT"] = 0] = "BINARY_CONTENT";
    FileSystemUploadType[FileSystemUploadType["MULTIPART"] = 1] = "MULTIPART";
})(FileSystemUploadType || (FileSystemUploadType = {}));
export var EncodingType;
(function (EncodingType) {
    EncodingType["UTF8"] = "utf8";
    EncodingType["Base64"] = "base64";
})(EncodingType || (EncodingType = {}));
export var FileSystemHttpMethods;
(function (FileSystemHttpMethods) {
    FileSystemHttpMethods[FileSystemHttpMethods["POST"] = 0] = "POST";
    FileSystemHttpMethods[FileSystemHttpMethods["PUT"] = 1] = "PUT";
    FileSystemHttpMethods[FileSystemHttpMethods["PATCH"] = 2] = "PATCH";
})(FileSystemHttpMethods || (FileSystemHttpMethods = {}));
//# sourceMappingURL=FileSystem.types.js.map