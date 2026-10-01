public with sharing class JotFormService {

    private static final String NAMED_CREDENTIAL = 'callout:JotForm_API';

    public class JotFormException extends Exception {}

    public class BlockoutDate {
        @AuraEnabled public String startDate;
        @AuraEnabled public String endDate;

        public BlockoutDate() {}

        public BlockoutDate(String startDate, String endDate) {
            this.startDate = startDate;
            this.endDate = endDate;
        }
    }

    public class AppointmentQuestion {
        @AuraEnabled public String qid;
        @AuraEnabled public String name;
        @AuraEnabled public String text;
        @AuraEnabled public List<BlockoutDate> blockoutDates;
    }

    private static HttpResponse sendRequest(String method, String path) {
        return sendRequest(method, path, null);
    }

    private static HttpResponse sendRequest(String method, String path, String body) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(NAMED_CREDENTIAL + path);
        req.setMethod(method);
        req.setTimeout(30000);
        if (body != null) {
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            req.setBody(body);
        }
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            String msg = 'JotForm API error (' + res.getStatusCode() + ')';
            try {
                Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                if (parsed.containsKey('message')) {
                    msg = (String) parsed.get('message');
                }
            } catch (Exception e) {
                // use default msg
            }
            throw new JotFormException(msg);
        }
        return res;
    }

    public static List<AppointmentQuestion> getAppointmentQuestions(String formId) {
        HttpResponse res = sendRequest('GET', '/v1/form/' + formId + '/questions');
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Map<String, Object> content = (Map<String, Object>) parsed.get('content');

        List<AppointmentQuestion> results = new List<AppointmentQuestion>();
        if (content == null) {
            return results;
        }

        for (String qid : content.keySet()) {
            Map<String, Object> question = (Map<String, Object>) content.get(qid);
            if (question == null) {
                continue;
            }
            String qType = (String) question.get('type');
            if (qType != 'control_appointment') {
                continue;
            }

            AppointmentQuestion aq = new AppointmentQuestion();
            aq.qid = qid;
            aq.name = (String) question.get('name');
            aq.text = (String) question.get('text');
            aq.blockoutDates = parseBlockoutDates((String) question.get('blockoutDates'));
            results.add(aq);
        }
        return results;
    }

    public static List<BlockoutDate> getBlockoutDates(String formId, String questionId) {
        HttpResponse res = sendRequest('GET', '/v1/form/' + formId + '/question/' + questionId);
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Map<String, Object> content = (Map<String, Object>) parsed.get('content');

        if (content == null) {
            return new List<BlockoutDate>();
        }
        return parseBlockoutDates((String) content.get('blockoutDates'));
    }

    public static void updateBlockoutDates(String formId, String questionId, List<BlockoutDate> dates) {
        String jsonDates = JSON.serialize(dates);
        String body = 'question[blockoutDates]=' + EncodingUtil.urlEncode(jsonDates, 'UTF-8');
        sendRequest('POST', '/v1/form/' + formId + '/question/' + questionId, body);
    }

    private static List<BlockoutDate> parseBlockoutDates(String raw) {
        List<BlockoutDate> dates = new List<BlockoutDate>();
        if (String.isBlank(raw) || raw == '[]') {
            return dates;
        }
        try {
            List<Object> parsed = (List<Object>) JSON.deserializeUntyped(raw);
            for (Object item : parsed) {
                Map<String, Object> dateMap = (Map<String, Object>) item;
                BlockoutDate bd = new BlockoutDate();
                bd.startDate = (String) dateMap.get('startDate');
                bd.endDate = (String) dateMap.get('endDate');
                dates.add(bd);
            }
        } catch (Exception e) {
            // malformed JSON — return empty
        }
        return dates;
    }
}
