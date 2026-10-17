public final class Locales {
    public static void main(String[] args) throws Exception {
        Class<?> list = Class.forName("android.os.LocaleList");
        Object locales = list.getMethod("forLanguageTags", String.class).invoke(null, args[0]);
        Class.forName("com.android.internal.app.LocalePicker").getMethod("updateLocales", list).invoke(null, locales);
    }
}
