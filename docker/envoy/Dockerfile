FROM public.ecr.aws/appmesh/aws-appmesh-envoy:v1.18.3.0-prod

RUN yum install -y openssl

RUN openssl genrsa -out key.pem 2048

RUN openssl req -new -key key.pem -out cert.csr -config cert.cfg -batch -sha256